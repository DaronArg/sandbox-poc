INSERT INTO student SELECT 1, 'Ana Alumna', 'ana@example.com' WHERE NOT EXISTS (SELECT 1 FROM student);
INSERT INTO student SELECT 2, 'Beto Alumno', 'beto@example.com' WHERE (SELECT COUNT(*) FROM student) = 1;
INSERT INTO exam SELECT 1, 'Examen Spring Boot', 'Implementar PriceService para que pasen los tests' WHERE NOT EXISTS (SELECT 1 FROM exam);
