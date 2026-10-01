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
    public void record(long sessionId, String type, String payloadJson) {
        record(sessionId, type, Timestamp.from(Instant.now()), payloadJson);
    }

    /** Igual que record, pero respetando el timestamp del cliente (eventos de la app desktop). */
    public synchronized void record(long sessionId, String type, Timestamp ts, String payloadJson) {
        insert(sessionId, nextSequence(sessionId), type, ts, payloadJson);
    }

    public long nextSequence(long sessionId) {
        return jdbc.queryForObject("SELECT COALESCE(MAX(sequence), 0) + 1 FROM event WHERE session_id = ?", Long.class, sessionId);
    }

    /** Inserta un evento con sequence y timestamp ya definidos (telemetria del agente). */
    public void insert(long sessionId, long sequence, String type, Timestamp ts, String payloadJson) {
        jdbc.update("INSERT INTO event (session_id, sequence, type, timestamp, payload) VALUES (?,?,?,?,?)",
                sessionId, sequence, type, ts, payloadJson);
    }
}
