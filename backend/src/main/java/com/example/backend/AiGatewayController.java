package com.example.backend;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;

/** Proxy transparente de la Messages API de Anthropic (incluye SSE). Valida el token de sesion (x-api-key). */
@RestController
public class AiGatewayController {
    private static final List<String> REQ_HEADERS = List.of("content-type", "anthropic-version", "anthropic-beta", "accept");
    private static final List<String> RES_HEADERS = List.of("content-type", "cache-control", "request-id", "anthropic-request-id");

    private final JdbcTemplate jdbc;
    private final EventService events;
    private final ObjectMapper mapper = new ObjectMapper();
    private final HttpClient http = HttpClient.newHttpClient();

    public AiGatewayController(JdbcTemplate jdbc, EventService events) {
        this.jdbc = jdbc;
        this.events = events;
    }

    @PostMapping("/ai/v1/messages")
    public void messages(HttpServletRequest req, HttpServletResponse res) throws Exception {
        String token = req.getHeader("x-api-key");
        List<Long> ids = token == null ? List.of() : jdbc.queryForList("SELECT id FROM session WHERE token = ? AND status <> 'COMPLETED'", Long.class, token);
        if (ids.isEmpty()) {
            res.setStatus(401);
            res.setContentType("application/json");
            res.getWriter().write("{\"type\":\"error\",\"error\":{\"type\":\"authentication_error\",\"message\":\"invalid session token\"}}");
            return;
        }
        long sessionId = ids.get(0);
        JsonNode json = mapper.readTree(req.getInputStream().readAllBytes());
        // Continue manda thinking.type=enabled, que los modelos nuevos rechazan: se descarta (POC).
        if (json instanceof ObjectNode o) o.remove("thinking");
        byte[] body = mapper.writeValueAsBytes(json);
        String model = json.path("model").asText("");
        boolean autocomplete = model.equals(System.getenv("AI_AUTOCOMPLETE_MODEL"));
        if (autocomplete) {
            events.record(sessionId, "AI_AUTOCOMPLETE", mapper.writeValueAsString(Map.of("model", model)));
        } else {
            events.record(sessionId, "AI_PROMPT", mapper.writeValueAsString(Map.of("model", model, "message", lastUserMessage(json))));
        }

        HttpRequest.Builder b = HttpRequest.newBuilder(URI.create("https://api.anthropic.com/v1/messages"))
                .header("x-api-key", System.getenv("ANTHROPIC_API_KEY"))
                .POST(HttpRequest.BodyPublishers.ofByteArray(body));
        for (String h : REQ_HEADERS) {
            String v = req.getHeader(h);
            if (v != null) b.header(h, v);
        }
        if (req.getHeader("anthropic-version") == null) b.header("anthropic-version", "2023-06-01");

        HttpResponse<InputStream> r = http.send(b.build(), HttpResponse.BodyHandlers.ofInputStream());
        res.setStatus(r.statusCode());
        for (String h : RES_HEADERS) r.headers().firstValue(h).ifPresent(v -> res.setHeader(h, v));

        ByteArrayOutputStream acc = new ByteArrayOutputStream();
        try (InputStream in = r.body()) {
            OutputStream out = res.getOutputStream();
            byte[] buf = new byte[4096];
            int n;
            while ((n = in.read(buf)) > 0) {
                out.write(buf, 0, n);
                out.flush();
                if (!autocomplete && acc.size() < 1_000_000) acc.write(buf, 0, n);
            }
        }
        if (!autocomplete) {
            events.record(sessionId, "AI_RESPONSE", mapper.writeValueAsString(Map.of("status", r.statusCode(), "text", extractText(acc.toString(StandardCharsets.UTF_8)))));
        }
    }

    private String lastUserMessage(JsonNode json) {
        JsonNode msgs = json.path("messages");
        for (int i = msgs.size() - 1; i >= 0; i--) {
            JsonNode m = msgs.get(i);
            if (!"user".equals(m.path("role").asText())) continue;
            JsonNode c = m.path("content");
            if (c.isTextual()) return c.asText();
            StringBuilder sb = new StringBuilder();
            for (JsonNode part : c) if (part.has("text")) sb.append(part.get("text").asText());
            return sb.toString();
        }
        return "";
    }

    /** SSE: concatena los text_delta; JSON normal: concatena los bloques text; si falla, devuelve el crudo. */
    private String extractText(String raw) {
        StringBuilder sb = new StringBuilder();
        try {
            if (raw.startsWith("event:") || raw.contains("\ndata:")) {
                for (String line : raw.split("\n")) {
                    if (!line.startsWith("data:")) continue;
                    JsonNode d = mapper.readTree(line.substring(5).trim());
                    if (d.path("delta").has("text")) sb.append(d.path("delta").path("text").asText());
                }
            } else {
                for (JsonNode part : mapper.readTree(raw).path("content")) if (part.has("text")) sb.append(part.get("text").asText());
            }
        } catch (Exception e) {
            return raw;
        }
        return sb.length() > 0 ? sb.toString() : raw;
    }
}
