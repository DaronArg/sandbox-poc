# Examen — PriceService

Implementá `PriceService.applyDiscount(price, percent)` para que pasen los tests (`./mvnw test`).

## Probar la API

Levantá el backend en la terminal del IDE:

```
./mvnw spring-boot:run
```

Queda en `localhost:8081`. Podés probarla de dos maneras:

- **Postman o curl** desde tu equipo: `GET http://localhost:8081/api/price?price=200&percent=25`.
- **REST Client** dentro del IDE: abrí `requests.http` y hacé clic en *Send Request*.

> La API no se puede abrir desde un navegador: usá Postman, curl o REST Client.

## Probar el front

```
cd frontend
npm install
npm run dev
```

Se ve en la pestaña **App** de la aplicación. Llama a `/api/...` y Vite lo reenvía a la API del puerto 8081.
