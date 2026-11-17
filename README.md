# MediStock — Sistema de Gestión de Insumos Clínicos Críticos

Aplicación Web Responsiva (React + Node.js/Express + SQLite3) desarrollada conforme al Acta de Constitución y Backlog de Sprints 1 a 4 del proyecto **MediStock**.

## Características Implementadas
1. **Autenticación y Control de Acceso por Roles (RBAC - HU-20, HU-21, HU-25):** Perfiles `TI_ADMIN`, `BODEGA`, `ENFERMERIA` y `JEFATURA`.
2. **Base de Datos Relacional en SQLite3 (`medistock.db`):** Tablas normalizadas (`usuarios`, `ubicaciones`, `insumos`, `lotes`, `movimientos`, `solicitudes_redistribucion`, `auditoria`).
3. **Auditoría Inalterable (HU-22):** Triggers SQLite (`BEFORE UPDATE` y `BEFORE DELETE`) que impiden modificar o borrar registros históricos.
4. **Trazabilidad de Lotes, Vencimientos FEFO y Escaneo QR/Barras (HU-01, HU-02, HU-03):** Lectura con cámara del dispositivo y descuento automático por fecha de vencimiento más próxima.
5. **Visibilidad Multi-Ubicación y Traspasos (HU-04, HU-07, HU-08, HU-09):** Bodega Central, Urgencias, Pabellón y Botiquín Piso 2, con exportación CSV.
6. **Resiliencia Offline-First (HU-05, HU-06):** Cola local en `localStorage` con sincronización automática al recuperar la conexión.
7. **Motor de Alertas, Redistribución Colaborativa y Analítica Predictiva (HU-10 a HU-19).**

## Ejecución
```bash
cd backend
npm install
npm start
```
Abrir en el navegador: `http://localhost:3000`
