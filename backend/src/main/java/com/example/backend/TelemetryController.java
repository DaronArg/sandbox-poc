package com.example.backend;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Map;

@RestController
public class TelemetryController {
    private final JdbcTemplate jdbc;
    private final EventService events;
    private final ObjectMapper mapper = new ObjectMapper();

    public TelemetryController(JdbcTemplate jdbc, EventService events) {
        this.jdbc = jdbc;
        this.events = events;
    }

    /** Repo de examen para armar el link a GitHub Actions en professor.html. */
    @GetMapping("/api/professor-config")
    public Map<String, String> professorConfig() {
        String repo = System.getenv("GITHUB_REPO");
        return Map.of("repo", repo == null || repo.isBlank() ? "DaronArg/assessment-exam-template" : repo);
    }

    @PostMapping("/api/telemetry/batch")
    @SuppressWarnings("unchecked")
    public Map<String, Object> batch(@RequestBody Map<String, Object> body,
                                     @RequestHeader(value = "Authorization", required = false) String auth) throws Exception {
        long sessionId = ((Number) body.get("sessionId")).longValue();
        List<String> tokens = jdbc.queryForList("SELECT token FROM session WHERE id = ?", String.class, sessionId);
        if (auth == null || !auth.startsWith("Bearer ") || tokens.isEmpty() || !tokens.get(0).equals(auth.substring(7))) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED);
        }
        List<Map<String, Object>> list = (List<Map<String, Object>>) body.get("events");
        for (Map<String, Object> e : list) {
            events.insert(sessionId, ((Number) e.get("sequence")).longValue(), (String) e.get("type"),
                    Timestamp.from(Instant.parse((String) e.get("timestamp"))),
                    mapper.writeValueAsString(e.get("payload")));
        }
        return Map.of("accepted", list.size());
    }
}
