package com.example.backend;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.List;

/** Proxy git smart HTTP: valida el token de sesion y reenvia a GitHub inyectando GITHUB_TOKEN. */
@RestController
public class GitProxyController {
    private static final List<String> REQ_HEADERS = List.of("content-type", "content-encoding", "accept", "git-protocol");
    private static final List<String> RES_HEADERS = List.of("content-type", "cache-control", "expires", "pragma");

    private final JdbcTemplate jdbc;
    private final EventService events;
    private final HttpClient http = HttpClient.newBuilder().followRedirects(HttpClient.Redirect.NORMAL).build();

    public GitProxyController(JdbcTemplate jdbc, EventService events) {
        this.jdbc = jdbc;
        this.events = events;
    }

    @RequestMapping("/git/{id}/repo.git/**")
    public void proxy(@PathVariable long id, HttpServletRequest req, HttpServletResponse res) throws Exception {
        if (!authorized(id, req.getHeader("Authorization"))) {
            res.setStatus(401);
            res.setHeader("WWW-Authenticate", "Basic realm=\"assessment\"");
            return;
        }
        String uri = req.getRequestURI();
        String rest = uri.substring(uri.indexOf("/repo.git") + "/repo.git".length());
        String query = req.getQueryString() == null ? "" : "?" + req.getQueryString();
        String target = "https://github.com/" + System.getenv("GITHUB_REPO") + ".git" + rest + query;
        String basic = Base64.getEncoder().encodeToString(
                ("x-access-token:" + System.getenv("GITHUB_TOKEN")).getBytes(StandardCharsets.UTF_8));

        HttpRequest.Builder b = HttpRequest.newBuilder(URI.create(target)).header("Authorization", "Basic " + basic);
        for (String h : REQ_HEADERS) {
            String v = req.getHeader(h);
            if (v != null) b.header(h, v);
        }
        InputStream in = req.getInputStream();
        b.method(req.getMethod(), "POST".equals(req.getMethod())
                ? HttpRequest.BodyPublishers.ofInputStream(() -> in)
                : HttpRequest.BodyPublishers.noBody());

        HttpResponse<InputStream> r = http.send(b.build(), HttpResponse.BodyHandlers.ofInputStream());
        res.setStatus(r.statusCode());
        for (String h : RES_HEADERS) r.headers().firstValue(h).ifPresent(v -> res.setHeader(h, v));
        try (InputStream body = r.body()) {
            body.transferTo(res.getOutputStream());
        }
        if (rest.endsWith("/git-receive-pack") && r.statusCode() == 200) {
            events.record(id, "GIT_PUSH", "{}");
        }
    }

    /** Basic auth: usuario "session", password = token de la sesion. */
    private boolean authorized(long id, String auth) {
        if (auth == null || !auth.startsWith("Basic ")) return false;
        String decoded;
        try {
            decoded = new String(Base64.getDecoder().decode(auth.substring(6)), StandardCharsets.UTF_8);
        } catch (IllegalArgumentException e) {
            return false;
        }
        int i = decoded.indexOf(':');
        if (i < 0) return false;
        List<String> tokens = jdbc.queryForList("SELECT token FROM session WHERE id = ? AND status <> 'COMPLETED'", String.class, id);
        return !tokens.isEmpty() && tokens.get(0).equals(decoded.substring(i + 1));
    }
}
