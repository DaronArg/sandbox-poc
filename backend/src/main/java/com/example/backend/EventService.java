package com.example.backend;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.sql.Timestamp;
import java.time.Instant;

@Service
public class EventService {
    private final JdbcTemplate jdbc;

    public EventService(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /** Registra un evento generado por el backend; sequence = siguiente de la sesion. */
    public synchronized void record(long sessionId, String type, String payloadJson) {
        Long seq = jdbc.queryForObject("SELECT COALESCE(MAX(sequence), 0) + 1 FROM event WHERE session_id = ?", Long.class, sessionId);
        insert(sessionId, seq, type, Timestamp.from(Instant.now()), payloadJson);
    }

    /** Inserta un evento con sequence y timestamp ya definidos (telemetria del agente). */
    public void insert(long sessionId, long sequence, String type, Timestamp ts, String payloadJson) {
        jdbc.update("INSERT INTO event (session_id, sequence, type, timestamp, payload) VALUES (?,?,?,?,?)",
                sessionId, sequence, type, ts, payloadJson);
    }
}
