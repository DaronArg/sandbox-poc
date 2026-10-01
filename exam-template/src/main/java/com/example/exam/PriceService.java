package com.example.exam;

import org.springframework.stereotype.Service;

@Service
public class PriceService {

    /**
     * Devuelve el precio final: aplica el porcentaje de descuento (0-100) al precio base.
     * Ej: applyDiscount(200.0, 25) = 150.0. Lanza IllegalArgumentException si el
     * porcentaje esta fuera de 0-100 o el precio es negativo.
     */
    public double applyDiscount(double price, int percent) {
        // TODO: implementar
        throw new UnsupportedOperationException("not implemented");
    }
}
