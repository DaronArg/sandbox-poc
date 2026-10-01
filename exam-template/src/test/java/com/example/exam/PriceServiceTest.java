package com.example.exam;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import org.junit.jupiter.api.Test;

class PriceServiceTest {

    private final PriceService service = new PriceService();

    @Test
    void appliesDiscount() {
        assertEquals(150.0, service.applyDiscount(200.0, 25), 0.001);
    }

    @Test
    void zeroPercentKeepsPrice() {
        assertEquals(80.0, service.applyDiscount(80.0, 0), 0.001);
    }

    @Test
    void rejectsInvalidPercent() {
        assertThrows(IllegalArgumentException.class, () -> service.applyDiscount(100.0, 101));
    }

    @Test
    void rejectsNegativePrice() {
        assertThrows(IllegalArgumentException.class, () -> service.applyDiscount(-1.0, 10));
    }
}
