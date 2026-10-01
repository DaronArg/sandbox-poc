package com.example.backend;

import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api")
public class ApiController {
    private final JdbcTemplate jdbc;
    private final EventService events;

    public ApiController(JdbcTemplate jdbc, EventService events) {
        this.jdbc = jdbc;
        this.events = events;
    }

    @GetMapping("/exams")
    public List<Map<String, Object>> exams() {
        return jdbc.queryForList("SELECT id AS \"id\", title AS \"title\", description AS \"description\" FROM exam");
    }

    @GetMapping("/students")
    public List<Map<String, Object>> students() {
        return jdbc.queryForList("SELECT id AS \"id\", name AS \"name\", email AS \"email\" FROM student");
    }

    @PostMapping("/sessions")
    public Map<String, Object> create(@RequestBody Map<String, Object> body) {
        long studentId = ((Number) body.get("studentId")).longValue();
        long examId = ((Number) body.get("examId")).longValue();
        String token = UUID.randomUUID().toString();
        jdbc.update("INSERT INTO session (token, student_id, exam_id, branch, status, created_at) VALUES (?,?,?,?,?,?)",
                token, studentId, examId, "pending", "CREATED", Timestamp.from(Instant.now()));
        long id = jdbc.queryForObject("SELECT MAX(id) FROM session", Long.class);
        String hex = UUID.randomUUID().toString().replace("-", "").substring(0, 6);
        jdbc.update("UPDATE session SET branch = ? WHERE id = ?", "session-" + id + "-" + hex, id);
        String dockerRun = "docker run --rm --name assessment-" + id
                + " -p 127.0.0.1:8080:8080 -p 127.0.0.1:8081:8081 -p 127.0.0.1:4200:4200"
                + " --add-host=host.docker.internal:host-gateway"
                + " -e SESSION_ID=" + id + " -e SESSION_TOKEN=" + token
                + " -e BACKEND_URL=http://host.docker.internal:9090"
                + " -v assessment_" + id + "_workspace:/workspace"
                + " assessment-runtime:poc";
        return Map.of("sessionId", id, "dockerRun", dockerRun);
    }

    @PostMapping("/sessions/{id}/connect")
    public Map<String, Object> connect(@PathVariable long id,
                                       @RequestHeader(value = "Authorization", required = false) String auth) {
        authorize(id, auth);
        jdbc.update("UPDATE session SET status = 'ACTIVE' WHERE id = ?", id);
        events.record(id, "SESSION_STARTED", "{}");
        Map<String, Object> result = new LinkedHashMap<>(jdbc.queryForMap("""
                SELECT s.exam_id AS "examId", s.branch AS "branch", st.name AS "studentName", st.email AS "studentEmail"
                FROM session s JOIN student st ON st.id = s.student_id WHERE s.id = ?""", id));
        result.put("chatModel", env("AI_CHAT_MODEL", "claude-sonnet-5-5"));
        result.put("autocompleteModel", env("AI_AUTOCOMPLETE_MODEL", "claude-haiku-4-5-20251001"));
        return result;
    }

    @PostMapping("/sessions/{id}/submit")
    public Map<String, Object> submit(@PathVariable long id, @RequestBody Map<String, Object> body,
                                      @RequestHeader(value = "Authorization", required = false) String auth) {
        authorize(id, auth);
        String sha = (String) body.get("sha");
        if (sha == null || sha.isBlank()) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "sha required");
        jdbc.update("UPDATE session SET final_sha = ?, status = 'COMPLETED' WHERE id = ?", sha, id);
        events.record(id, "SUBMISSION_COMPLETED", "{\"sha\":\"" + sha.replaceAll("[^0-9a-fA-F]", "") + "\"}");
        return Map.of("status", "COMPLETED", "finalSha", sha);
    }

    /** Resultado del CI en GitHub para el SHA final (o el branch si no hubo submit). Consulta bajo demanda. */
    @GetMapping("/sessions/{id}/result")
    public Map<String, Object> result(@PathVariable long id) {
        List<Map<String, Object>> rows = jdbc.queryForList(
                "SELECT status AS \"status\", branch AS \"branch\", final_sha AS \"finalSha\" FROM session WHERE id = ?", id);
        if (rows.isEmpty()) throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        String sha = (String) rows.get(0).get("finalSha");
        String branch = (String) rows.get(0).get("branch");
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("status", rows.get(0).get("status"));
        out.put("finalSha", sha);
        out.put("ciStatus", "none");
        out.put("ciConclusion", null);
        out.put("ciUrl", null);
        try {
            String q = sha != null ? "head_sha=" + sha : "branch=" + URLEncoder.encode(branch, StandardCharsets.UTF_8);
            HttpRequest req = HttpRequest.newBuilder(URI.create("https://api.github.com/repos/" + System.getenv("GITHUB_REPO")
                            + "/actions/runs?per_page=1&" + q))
                    .header("Authorization", "Bearer " + System.getenv("GITHUB_TOKEN"))
                    .header("Accept", "application/vnd.github+json").GET().build();
            HttpResponse<String> res = HttpClient.newHttpClient().send(req, HttpResponse.BodyHandlers.ofString());
            if (res.statusCode() != 200) {
                out.put("ciStatus", "unknown");
            } else {
                JsonNode runs = new ObjectMapper().readTree(res.body()).path("workflow_runs");
                if (runs.size() > 0) {
                    JsonNode run = runs.get(0);
                    out.put("ciStatus", run.path("status").asText(null));
                    out.put("ciConclusion", run.path("conclusion").isNull() ? null : run.path("conclusion").asText(null));
                    out.put("ciUrl", run.path("html_url").asText(null));
                }
            }
        } catch (Exception e) {
            out.put("ciStatus", "unknown");
        }
        return out;
    }

    @GetMapping("/sessions")
    public List<Map<String, Object>> sessions() {
        return jdbc.queryForList("""
                SELECT s.id AS "id", s.status AS "status", s.branch AS "branch", s.created_at AS "createdAt", s.final_sha AS "finalSha",
                       st.name AS "studentName", e.title AS "examTitle"
                FROM session s JOIN student st ON st.id = s.student_id JOIN exam e ON e.id = s.exam_id
                ORDER BY s.id DESC""");
    }

    @GetMapping("/sessions/{id}/events")
    public List<Map<String, Object>> events(@PathVariable long id) {
        return jdbc.queryForList("""
                SELECT id AS "id", session_id AS "sessionId", sequence AS "sequence", type AS "type",
                       timestamp AS "timestamp", payload AS "payload"
                FROM event WHERE session_id = ? ORDER BY timestamp, id""", id);
    }

    private static String env(String key, String def) {
        String v = System.getenv(key);
        return v == null || v.isBlank() ? def : v;
    }

    /** Valida "Authorization: Bearer <token>" contra la sesion; 401 si no coincide. */
    private void authorize(long id, String auth) {
        List<String> tokens = jdbc.queryForList("SELECT token FROM session WHERE id = ? AND status <> 'COMPLETED'", String.class, id);
        if (auth == null || !auth.startsWith("Bearer ") || tokens.isEmpty() || !tokens.get(0).equals(auth.substring(7))) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED);
        }
    }
}
