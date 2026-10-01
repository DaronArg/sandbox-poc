package com.example.backend;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.jdbc.support.KeyHolder;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.security.SecureRandom;
import java.sql.PreparedStatement;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

@RestController
@RequestMapping("/api")
public class ApiController {
    private final JdbcTemplate jdbc;
    private final EventService events;
    private final ObjectMapper json = new ObjectMapper();

    public ApiController(JdbcTemplate jdbc, EventService events) {
        this.jdbc = jdbc;
        this.events = events;
    }

    static class UpgradeRequired extends RuntimeException {
        final String minVersion;
        UpgradeRequired(String minVersion) { this.minVersion = minVersion; }
    }

    @ExceptionHandler(UpgradeRequired.class)
    public ResponseEntity<Map<String, Object>> upgradeRequired(UpgradeRequired e) {
        return ResponseEntity.status(426).body(Map.of("error", "app desktop desactualizada", "minVersion", e.minVersion));
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
    public Map<String, Object> create(@RequestBody Map<String, Object> body,
                                      @RequestHeader(value = "X-Desktop-Version", required = false) String version) {
        checkVersion(version);
        long studentId = ((Number) body.get("studentId")).longValue();
        long examId = ((Number) body.get("examId")).longValue();
        String token = UUID.randomUUID().toString();
        KeyHolder keys = new GeneratedKeyHolder();
        jdbc.update(con -> {
            PreparedStatement ps = con.prepareStatement(
                    "INSERT INTO session (token, student_id, exam_id, branch, status, created_at) VALUES (?,?,?,?,?,?)",
                    new String[]{"ID"});
            ps.setString(1, token);
            ps.setLong(2, studentId);
            ps.setLong(3, examId);
            ps.setString(4, "pending");
            ps.setString(5, "CREATED");
            ps.setTimestamp(6, Timestamp.from(Instant.now()));
            return ps;
        }, keys);
        long id = keys.getKey().longValue();
        String hex = HexFormat.of().formatHex(randomBytes(3));
        jdbc.update("UPDATE session SET branch = ?, container_name = ?, volume = ? WHERE id = ?",
                "session-" + id + "-" + hex, "assessment-" + id + "-" + hex, "assessment_" + id + "_" + hex + "_workspace", id);
        return sessionInfo(id, token);
    }

    @GetMapping("/sessions/{id}/status")
    public Map<String, Object> status(@PathVariable long id,
                                      @RequestHeader(value = "Authorization", required = false) String auth,
                                      @RequestHeader(value = "X-Desktop-Version", required = false) String version) {
        checkVersion(version);
        authorize(id, auth);
        Map<String, Object> info = sessionInfo(id, null);
        info.remove("token");
        info.put("status", jdbc.queryForObject("SELECT status FROM session WHERE id = ?", String.class, id));
        return info;
    }

    @PostMapping("/sessions/{id}/desktop-events")
    @SuppressWarnings("unchecked")
    public Map<String, Object> desktopEvents(@PathVariable long id, @RequestBody Map<String, Object> body,
                                             @RequestHeader(value = "Authorization", required = false) String auth) {
        authorize(id, auth);
        List<Map<String, Object>> list = (List<Map<String, Object>>) body.getOrDefault("events", List.of());
        for (Map<String, Object> e : list) {
            if (!DESKTOP_TYPES.contains(String.valueOf(e.get("type")))) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "tipo de evento invalido");
            }
        }
        for (Map<String, Object> e : list) {
            Object ts = e.get("timestamp");
            Timestamp when = ts instanceof Number n ? Timestamp.from(Instant.ofEpochMilli(n.longValue()))
                    : ts == null ? Timestamp.from(Instant.now()) : Timestamp.from(Instant.parse(String.valueOf(ts)));
            String payload;
            try {
                payload = json.writeValueAsString(e.getOrDefault("payload", Map.of()));
            } catch (JsonProcessingException ex) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "payload invalido");
            }
            events.record(id, String.valueOf(e.get("type")), when, payload);
        }
        return Map.of("accepted", list.size());
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
        result.put("nextSequence", events.nextSequence(id));
        return result;
    }

    private static final Set<String> DESKTOP_TYPES = Set.of(
            "DESKTOP_STARTED", "DESKTOP_FOCUS_LOST", "DESKTOP_FOCUS_GAINED", "DESKTOP_TAB_CHANGED", "DESKTOP_CLOSED");

    private static byte[] randomBytes(int n) {
        byte[] b = new byte[n];
        new SecureRandom().nextBytes(b);
        return b;
    }

    private Map<String, Object> sessionInfo(long id, String token) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("sessionId", id);
        if (token != null) m.put("token", token);
        m.putAll(jdbc.queryForMap("""
                SELECT s.branch AS "branch", s.container_name AS "containerName", s.volume AS "volume",
                       st.name AS "studentName", e.title AS "examTitle"
                FROM session s JOIN student st ON st.id = s.student_id JOIN exam e ON e.id = s.exam_id
                WHERE s.id = ?""", id));
        m.put("image", env("RUNTIME_IMAGE", "assessment-runtime:poc"));
        m.put("containerBackendUrl", env("CONTAINER_BACKEND_URL", "http://host.docker.internal:9090"));
        return m;
    }

    /** 426 si X-Desktop-Version falta o es menor que DESKTOP_MIN_VERSION (semver numerico). */
    private void checkVersion(String version) {
        String min = env("DESKTOP_MIN_VERSION", "0.1.0");
        if (version == null || compareVersions(version, min) < 0) {
            throw new UpgradeRequired(min);
        }
    }

    private static int compareVersions(String a, String b) {
        String[] x = a.trim().split("\\."), y = b.trim().split("\\.");
        for (int i = 0; i < 3; i++) {
            int p = i < x.length ? parse(x[i]) : 0, q = i < y.length ? parse(y[i]) : 0;
            if (p != q) return Integer.compare(p, q);
        }
        return 0;
    }

    private static int parse(String s) {
        try {
            return Integer.parseInt(s.replaceAll("\\D.*$", ""));
        } catch (NumberFormatException e) {
            return 0;
        }
    }

    @GetMapping("/sessions")
    public List<Map<String, Object>> sessions() {
        return jdbc.queryForList("""
                SELECT s.id AS "id", s.status AS "status", s.branch AS "branch", s.created_at AS "createdAt",
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
        List<String> tokens = jdbc.queryForList("SELECT token FROM session WHERE id = ?", String.class, id);
        if (auth == null || !auth.startsWith("Bearer ") || tokens.isEmpty() || !tokens.get(0).equals(auth.substring(7))) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED);
        }
    }
}
