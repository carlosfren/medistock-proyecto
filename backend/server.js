const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));

// ==================== CAPA DE DATOS (SQLite3) ====================
const DB_PATH = path.join(__dirname, 'medistock.db');
const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) console.error('Error abriendo SQLite:', err.message);
  else console.log('Base de datos SQLite conectada en:', DB_PATH);
});

// Helpers Promisified para SQLite
function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

function hashPassword(pw) {
  return crypto.createHash('sha256').update(pw).digest('hex');
}

// Inicialización del Modelo Relacional Normalizado + Triggers de Auditoría Inalterable
async function initDatabase() {
  await dbRun(`PRAGMA foreign_keys = ON;`);

  // Tabla Usuarios con Roles (RBAC: TI_ADMIN, BODEGA, ENFERMERIA, JEFATURA)
  await dbRun(`
    CREATE TABLE IF NOT EXISTS usuarios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      rol TEXT NOT NULL CHECK(rol IN ('TI_ADMIN', 'BODEGA', 'ENFERMERIA', 'JEFATURA')),
      ubicacion_asignada_id INTEGER,
      activo INTEGER DEFAULT 1,
      creado_en DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Tabla Ubicaciones Hospitalarias
  await dbRun(`
    CREATE TABLE IF NOT EXISTS ubicaciones (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      codigo TEXT UNIQUE NOT NULL,
      nombre TEXT NOT NULL,
      tipo TEXT NOT NULL
    )
  `);

  // Catálogo Maestro de Insumos Clínicos
  await dbRun(`
    CREATE TABLE IF NOT EXISTS insumos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      codigo_barra TEXT UNIQUE NOT NULL,
      nombre TEXT NOT NULL,
      categoria TEXT NOT NULL,
      unidad_medida TEXT NOT NULL,
      stock_minimo INTEGER NOT NULL DEFAULT 10,
      stock_maximo INTEGER NOT NULL DEFAULT 100,
      precio_unitario REAL NOT NULL DEFAULT 0
    )
  `);

  // Lotes por Ubicación (Trazabilidad de fecha elaboración, vencimiento FEFO y stock por servicio)
  await dbRun(`
    CREATE TABLE IF NOT EXISTS lotes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      insumo_id INTEGER NOT NULL,
      ubicacion_id INTEGER NOT NULL,
      numero_lote TEXT NOT NULL,
      fecha_ingreso DATE NOT NULL,
      fecha_elaboracion DATE NOT NULL,
      fecha_vencimiento DATE NOT NULL,
      cantidad INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (insumo_id) REFERENCES insumos(id),
      FOREIGN KEY (ubicacion_id) REFERENCES ubicaciones(id)
    )
  `);

  // Movimientos de Inventario (Ingreso, Consumo por Escaneo, Traspaso / Redistribución)
  await dbRun(`
    CREATE TABLE IF NOT EXISTS movimientos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tipo TEXT NOT NULL CHECK(tipo IN ('INGRESO', 'CONSUMO', 'TRASPASO')),
      insumo_id INTEGER NOT NULL,
      lote_id INTEGER NOT NULL,
      ubicacion_origen_id INTEGER,
      ubicacion_destino_id INTEGER,
      cantidad INTEGER NOT NULL,
      usuario_id INTEGER NOT NULL,
      observacion TEXT,
      fecha DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (insumo_id) REFERENCES insumos(id),
      FOREIGN KEY (lote_id) REFERENCES lotes(id),
      FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
    )
  `);

  // Solicitudes de Redistribución entre Servicios (HU-16, HU-17)
  await dbRun(`
    CREATE TABLE IF NOT EXISTS solicitudes_redistribucion (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      insumo_id INTEGER NOT NULL,
      ubicacion_origen_id INTEGER NOT NULL,
      ubicacion_destino_id INTEGER NOT NULL,
      cantidad INTEGER NOT NULL,
      estado TEXT NOT NULL DEFAULT 'PENDIENTE' CHECK(estado IN ('PENDIENTE', 'APROBADA', 'RECHAZADA')),
      solicitante_id INTEGER NOT NULL,
      aprobador_id INTEGER,
      creado_en DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (insumo_id) REFERENCES insumos(id)
    )
  `);

  // Tabla de Auditoría Inalterable (HU-22)
  await dbRun(`
    CREATE TABLE IF NOT EXISTS auditoria (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      usuario_email TEXT NOT NULL,
      rol TEXT NOT NULL,
      accion TEXT NOT NULL,
      entidad TEXT NOT NULL,
      detalle TEXT NOT NULL,
      fecha_hora DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // TRIGGERS QUE BLOQUEAN UPDATE Y DELETE EN AUDITORÍA (Requisito explícito del Acta)
  await dbRun(`
    CREATE TRIGGER IF NOT EXISTS bloquear_update_auditoria
    BEFORE UPDATE ON auditoria
    BEGIN
      SELECT RAISE(ABORT, 'VIOLACION DE SEGURIDAD: La tabla auditoria es inalterable (UPDATE prohibido).');
    END;
  `);

  await dbRun(`
    CREATE TRIGGER IF NOT EXISTS bloquear_delete_auditoria
    BEFORE DELETE ON auditoria
    BEGIN
      SELECT RAISE(ABORT, 'VIOLACION DE SEGURIDAD: La tabla auditoria es inalterable (DELETE prohibido).');
    END;
  `);

  // Seed inicial si la BD está vacía
  const countUbi = await dbGet(`SELECT COUNT(*) as total FROM ubicaciones`);
  if (countUbi.total === 0) {
    await dbRun(`INSERT INTO ubicaciones (codigo, nombre, tipo) VALUES
      ('BOD-CENTRAL', 'Bodega Central Hospital', 'BODEGA'),
      ('URG-01', 'Servicio de Urgencias', 'CLINICO'),
      ('PAB-01', 'Pabellón Quirúrgico', 'CLINICO'),
      ('BOT-PISO2', 'Botiquín Hospitalización Piso 2', 'BOTIQUIN')
    `);

    await dbRun(`INSERT INTO usuarios (nombre, email, password_hash, rol, ubicacion_asignada_id) VALUES
      ('Carlos Fren (Admin TI)', 'admin@medistock.cl', ?, 'TI_ADMIN', 1),
      ('Encargado Bodega Central', 'bodega@medistock.cl', ?, 'BODEGA', 1),
      ('Enfermería Urgencias', 'enfermeria@medistock.cl', ?, 'ENFERMERIA', 2),
      ('Jefatura Pabellón', 'jefatura@medistock.cl', ?, 'JEFATURA', 3)
    `, [hashPassword('123456'), hashPassword('123456'), hashPassword('123456'), hashPassword('123456')]);

    await dbRun(`INSERT INTO insumos (codigo_barra, nombre, categoria, unidad_medida, stock_minimo, stock_maximo, precio_unitario) VALUES
      ('7801001001', 'Suero Fisiológico 0.9% 500ml', 'Sueros y Soluciones', 'Unidad', 20, 120, 1450),
      ('7801001002', 'Guantes Quirúrgicos Estériles Talla M', 'Protección Personal', 'Caja x50', 15, 80, 8900),
      ('7801001003', 'Jeringa Desechable 10ml con Aguja', 'Inyectables', 'Caja x100', 10, 60, 6500),
      ('7801001004', 'Catéter Intravenoso 20G', 'Vía Venosa', 'Unidad', 25, 100, 980),
      ('7801001005', 'Gasa Estéril 10x10cm', 'Curación', 'Paquete x10', 30, 150, 1200)
    `);

    // Fechas dinámicas relativas a hoy para demostrar alertas FEFO (<30 días) y normales
    const hoy = new Date();
    const fmt = (d) => d.toISOString().split('T')[0];
    const hace30 = new Date(hoy); hace30.setDate(hoy.getDate() - 30);
    const hace90 = new Date(hoy); hace90.setDate(hoy.getDate() - 90);
    const en12Dias = new Date(hoy); en12Dias.setDate(hoy.getDate() + 12); // Vence en < 30 días (Alerta FEFO)
    const en22Dias = new Date(hoy); en22Dias.setDate(hoy.getDate() + 22); // Vence en < 30 días (Alerta FEFO)
    const en180Dias = new Date(hoy); en180Dias.setDate(hoy.getDate() + 180);

    await dbRun(`INSERT INTO lotes (insumo_id, ubicacion_id, numero_lote, fecha_ingreso, fecha_elaboracion, fecha_vencimiento, cantidad) VALUES
      (1, 1, 'LOT-SF-2026A', ?, ?, ?, 85),
      (1, 2, 'LOT-SF-2026B', ?, ?, ?, 8),
      (1, 4, 'LOT-SF-2026C', ?, ?, ?, 65),
      (2, 1, 'LOT-GQ-991', ?, ?, ?, 40),
      (2, 3, 'LOT-GQ-992', ?, ?, ?, 5),
      (3, 1, 'LOT-JR-310', ?, ?, ?, 55),
      (4, 2, 'LOT-CT-401', ?, ?, ?, 12),
      (5, 4, 'LOT-GS-501', ?, ?, ?, 165)
    `, [
      fmt(hace30), fmt(hace90), fmt(en180Dias),
      fmt(hace30), fmt(hace90), fmt(en12Dias),
      fmt(hace30), fmt(hace90), fmt(en180Dias),
      fmt(hace30), fmt(hace90), fmt(en180Dias),
      fmt(hace30), fmt(hace90), fmt(en22Dias),
      fmt(hace30), fmt(hace90), fmt(en180Dias),
      fmt(hace30), fmt(hace90), fmt(en12Dias),
      fmt(hace30), fmt(hace90), fmt(en180Dias)
    ]);

    // Historial simulado de consumos para analítica y proyección (HU-18, HU-19)
    await dbRun(`INSERT INTO movimientos (tipo, insumo_id, lote_id, ubicacion_origen_id, cantidad, usuario_id, observacion) VALUES
      ('CONSUMO', 1, 2, 2, 24, 3, 'Consumo atención Urgencias'),
      ('CONSUMO', 2, 5, 3, 18, 4, 'Consumo Pabellón Quirúrgico'),
      ('CONSUMO', 4, 7, 2, 30, 3, 'Consumo box reanimación'),
      ('INGRESO', 1, 1, 1, 85, 2, 'Recepción proveedor oficial')
    `);

    await registrarAuditoria('sistema@medistock.cl', 'TI_ADMIN', 'INIT_DB', 'SISTEMA', 'Inicialización de base de datos SQLite y triggers inalterables.');
  }
}

async function registrarAuditoria(email, rol, accion, entidad, detalle) {
  await dbRun(
    `INSERT INTO auditoria (usuario_email, rol, accion, entidad, detalle) VALUES (?, ?, ?, ?, ?)`,
    [email, rol, accion, entidad, detalle]
  );
}

// ==================== SEGURIDAD Y MIDDLEWARE RBAC ====================
const sesiones = new Map();

function autenticar(req, res, next) {
  const auth = req.headers['authorization'];
  const token = auth && auth.split(' ')[1];
  if (!token || !sesiones.has(token)) {
    return res.status(401).json({ error: 'Sesión inválida o expirada.' });
  }
  req.user = sesiones.get(token);
  next();
}

function permitirRoles(...rolesPermitidos) {
  return (req, res, next) => {
    if (!rolesPermitidos.includes(req.user.rol)) {
      return res.status(403).json({
        error: `Acceso denegado para el rol ${req.user.rol}. Se requiere: ${rolesPermitidos.join(', ')}`
      });
    }
    next();
  };
}

// ==================== ENDPOINTS AUTENTICACIÓN Y USUARIOS ====================

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await dbGet(
      `SELECT u.*, ub.nombre as ubicacion_nombre FROM usuarios u
       LEFT JOIN ubicaciones ub ON u.ubicacion_asignada_id = ub.id
       WHERE u.email = ? AND u.password_hash = ? AND u.activo = 1`,
      [email.trim().toLowerCase(), hashPassword(password)]
    );
    if (!user) return res.status(401).json({ error: 'Credenciales incorrectas o usuario inactivo.' });

    const token = crypto.randomBytes(24).toString('hex');
    const sessionData = {
      id: user.id,
      nombre: user.nombre,
      email: user.email,
      rol: user.rol,
      ubicacion_asignada_id: user.ubicacion_asignada_id,
      ubicacion_nombre: user.ubicacion_nombre
    };
    sesiones.set(token, sessionData);
    await registrarAuditoria(user.email, user.rol, 'LOGIN', 'USUARIOS', 'Inicio de sesión exitoso en plataforma.');
    res.json({ token, usuario: sessionData });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/auth/registro', async (req, res) => {
  try {
    const { nombre, email, password, rol, ubicacion_asignada_id } = req.body;
    if (!nombre || !email || !password || !rol) {
      return res.status(400).json({ error: 'Todos los campos son obligatorios.' });
    }
    const existe = await dbGet(`SELECT id FROM usuarios WHERE email = ?`, [email.trim().toLowerCase()]);
    if (existe) return res.status(409).json({ error: 'El correo ya está registrado.' });

    await dbRun(
      `INSERT INTO usuarios (nombre, email, password_hash, rol, ubicacion_asignada_id) VALUES (?, ?, ?, ?, ?)`,
      [nombre.trim(), email.trim().toLowerCase(), hashPassword(password), rol, ubicacion_asignada_id || 1]
    );
    await registrarAuditoria(email, rol, 'REGISTRO', 'USUARIOS', `Nuevo usuario registrado con rol ${rol}.`);
    res.status(201).json({ mensaje: 'Usuario registrado correctamente. Ya puedes iniciar sesión.' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/usuarios', autenticar, permitirRoles('TI_ADMIN'), async (req, res) => {
  const rows = await dbAll(`
    SELECT u.id, u.nombre, u.email, u.rol, u.activo, ub.nombre as ubicacion
    FROM usuarios u LEFT JOIN ubicaciones ub ON u.ubicacion_asignada_id = ub.id
  `);
  res.json(rows);
});

app.patch('/api/usuarios/:id/rol', autenticar, permitirRoles('TI_ADMIN'), async (req, res) => {
  const { rol, activo } = req.body;
  await dbRun(`UPDATE usuarios SET rol = COALESCE(?, rol), activo = COALESCE(?, activo) WHERE id = ?`, [rol, activo, req.params.id]);
  await registrarAuditoria(req.user.email, req.user.rol, 'UPDATE_USER', 'USUARIOS', `Modificación de rol/estado usuario ID ${req.params.id}`);
  res.json({ mensaje: 'Usuario actualizado.' });
});

// ==================== ENDPOINTS CATÁLOGO, LOTES Y MULTI-UBICACIÓN ====================

app.get('/api/ubicaciones', autenticar, async (req, res) => {
  const rows = await dbAll(`SELECT * FROM ubicaciones`);
  res.json(rows);
});

app.get('/api/insumos', autenticar, async (req, res) => {
  const insumos = await dbAll(`SELECT * FROM insumos ORDER BY nombre ASC`);
  const lotes = await dbAll(`
    SELECT l.*, u.nombre as ubicacion_nombre, u.codigo as ubicacion_codigo
    FROM lotes l
    JOIN ubicaciones u ON l.ubicacion_id = u.id
    WHERE l.cantidad > 0
    ORDER BY l.fecha_vencimiento ASC
  `);

  const resultado = insumos.map(ins => {
    const lotesInsumo = lotes.filter(l => l.insumo_id === ins.id);
    const stockTotal = lotesInsumo.reduce((sum, l) => sum + l.cantidad, 0);
    return { ...ins, stockTotal, lotes: lotesInsumo };
  });
  res.json(resultado);
});

// HU-24: Crear nuevo insumo en catálogo maestro
app.post('/api/insumos', autenticar, permitirRoles('TI_ADMIN', 'BODEGA'), async (req, res) => {
  try {
    const { codigo_barra, nombre, categoria, unidad_medida, stock_minimo, stock_maximo, precio_unitario } = req.body;
    const r = await dbRun(
      `INSERT INTO insumos (codigo_barra, nombre, categoria, unidad_medida, stock_minimo, stock_maximo, precio_unitario)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [codigo_barra.trim(), nombre.trim(), categoria.trim(), unidad_medida.trim(), stock_minimo, stock_maximo, precio_unitario]
    );
    await registrarAuditoria(req.user.email, req.user.rol, 'CREAR_INSUMO', 'INSUMOS', `Insumo creado: ${nombre} (${codigo_barra})`);
    res.status(201).json({ id: r.lastID, mensaje: 'Insumo registrado en catálogo.' });
  } catch (e) {
    res.status(400).json({ error: 'Error al crear insumo (verifique que el código de barras no esté duplicado).' });
  }
});

// HU-03: Registrar ingreso a bodega con lote y fechas
app.post('/api/inventario/ingreso', autenticar, permitirRoles('TI_ADMIN', 'BODEGA'), async (req, res) => {
  try {
    const { insumo_id, ubicacion_id, numero_lote, fecha_elaboracion, fecha_vencimiento, cantidad } = req.body;
    const fecha_ingreso = new Date().toISOString().split('T')[0];

    const r = await dbRun(
      `INSERT INTO lotes (insumo_id, ubicacion_id, numero_lote, fecha_ingreso, fecha_elaboracion, fecha_vencimiento, cantidad)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [insumo_id, ubicacion_id || 1, numero_lote.trim().toUpperCase(), fecha_ingreso, fecha_elaboracion, fecha_vencimiento, parseInt(cantidad, 10)]
    );

    await dbRun(
      `INSERT INTO movimientos (tipo, insumo_id, lote_id, ubicacion_destino_id, cantidad, usuario_id, observacion)
       VALUES ('INGRESO', ?, ?, ?, ?, ?, ?)`,
      [insumo_id, r.lastID, ubicacion_id || 1, cantidad, req.user.id, `Ingreso lote ${numero_lote}`]
    );

    await registrarAuditoria(req.user.email, req.user.rol, 'INGRESO_STOCK', 'LOTES', `Ingreso de ${cantidad} unid. Lote ${numero_lote} (Vence: ${fecha_vencimiento})`);
    res.status(201).json({ mensaje: 'Ingreso registrado con trazabilidad de lote.' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// HU-01 & HU-02: Sugerencia FEFO y Registro de Consumo por Escaneo (soporta sincronización offline)
app.get('/api/inventario/fefo/:codigo_barra', autenticar, async (req, res) => {
  const insumo = await dbGet(`SELECT * FROM insumos WHERE codigo_barra = ?`, [req.params.codigo_barra.trim()]);
  if (!insumo) return res.status(404).json({ error: 'Código de barras / QR no encontrado en el catálogo.' });

  const lotes = await dbAll(`
    SELECT l.*, u.nombre as ubicacion_nombre
    FROM lotes l JOIN ubicaciones u ON l.ubicacion_id = u.id
    WHERE l.insumo_id = ? AND l.cantidad > 0
    ORDER BY l.fecha_vencimiento ASC
  `, [insumo.id]);

  res.json({ insumo, lotesSugeridosFEFO: lotes });
});

app.post('/api/inventario/consumo', autenticar, async (req, res) => {
  try {
    const { codigo_barra, ubicacion_id, lote_id, cantidad, observacion, fecha_offline } = req.body;
    const cant = parseInt(cantidad, 10);

    const insumo = await dbGet(`SELECT * FROM insumos WHERE codigo_barra = ?`, [codigo_barra.trim()]);
    if (!insumo) return res.status(404).json({ error: 'Insumo no encontrado.' });

    // Si no se especifica lote_id, aplicar automáticamente FEFO (el lote más próximo a vencer en esa ubicación)
    let lote;
    if (lote_id) {
      lote = await dbGet(`SELECT * FROM lotes WHERE id = ? AND cantidad >= ?`, [lote_id, cant]);
    } else {
      lote = await dbGet(
        `SELECT * FROM lotes WHERE insumo_id = ? AND ubicacion_id = ? AND cantidad >= ? ORDER BY fecha_vencimiento ASC LIMIT 1`,
        [insumo.id, ubicacion_id, cant]
      );
    }

    if (!lote) {
      return res.status(400).json({ error: 'Stock insuficiente en la ubicación seleccionada para descontar esa cantidad.' });
    }

    await dbRun(`UPDATE lotes SET cantidad = cantidad - ? WHERE id = ?`, [cant, lote.id]);
    await dbRun(
      `INSERT INTO movimientos (tipo, insumo_id, lote_id, ubicacion_origen_id, cantidad, usuario_id, observacion, fecha)
       VALUES ('CONSUMO', ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP))`,
      [insumo.id, lote.id, lote.ubicacion_id, cant, req.user.id, observacion || 'Consumo clínico por escaneo', fecha_offline || null]
    );

    await registrarAuditoria(
      req.user.email,
      req.user.rol,
      fecha_offline ? 'SYNC_CONSUMO_OFFLINE' : 'CONSUMO_ESCANEO',
      'MOVIMIENTOS',
      `Consumo de ${cant} x ${insumo.nombre} (Lote FEFO: ${lote.numero_lote})`
    );

    res.json({ mensaje: `Consumo registrado (Lote FEFO utilizado: ${lote.numero_lote}).` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// HU-04: Traspaso directo entre ubicaciones
app.post('/api/inventario/traspaso', autenticar, permitirRoles('TI_ADMIN', 'BODEGA', 'JEFATURA'), async (req, res) => {
  try {
    const { lote_id, ubicacion_destino_id, cantidad } = req.body;
    const cant = parseInt(cantidad, 10);
    const loteOrigen = await dbGet(`SELECT * FROM lotes WHERE id = ?`, [lote_id]);

    if (!loteOrigen || loteOrigen.cantidad < cant) {
      return res.status(400).json({ error: 'Stock insuficiente en el lote de origen.' });
    }
    if (loteOrigen.ubicacion_id == ubicacion_destino_id) {
      return res.status(400).json({ error: 'La ubicación de destino debe ser distinta a la de origen.' });
    }

    await dbRun(`UPDATE lotes SET cantidad = cantidad - ? WHERE id = ?`, [cant, loteOrigen.id]);

    // Verificar si ya existe el mismo lote en destino
    const loteDestino = await dbGet(
      `SELECT * FROM lotes WHERE insumo_id = ? AND ubicacion_id = ? AND numero_lote = ?`,
      [loteOrigen.insumo_id, ubicacion_destino_id, loteOrigen.numero_lote]
    );

    if (loteDestino) {
      await dbRun(`UPDATE lotes SET cantidad = cantidad + ? WHERE id = ?`, [cant, loteDestino.id]);
    } else {
      await dbRun(
        `INSERT INTO lotes (insumo_id, ubicacion_id, numero_lote, fecha_ingreso, fecha_elaboracion, fecha_vencimiento, cantidad)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [loteOrigen.insumo_id, ubicacion_destino_id, loteOrigen.numero_lote, loteOrigen.fecha_ingreso, loteOrigen.fecha_elaboracion, loteOrigen.fecha_vencimiento, cant]
      );
    }

    await dbRun(
      `INSERT INTO movimientos (tipo, insumo_id, lote_id, ubicacion_origen_id, ubicacion_destino_id, cantidad, usuario_id, observacion)
       VALUES ('TRASPASO', ?, ?, ?, ?, ?, ?, ?)`,
      [loteOrigen.insumo_id, loteOrigen.id, loteOrigen.ubicacion_id, ubicacion_destino_id, cant, req.user.id, `Traspaso interno lote ${loteOrigen.numero_lote}`]
    );

    await registrarAuditoria(req.user.email, req.user.rol, 'TRASPASO', 'MOVIMIENTOS', `Traspaso de ${cant} unid. Lote ${loteOrigen.numero_lote} hacia ubicación ID ${ubicacion_destino_id}`);
    res.json({ mensaje: 'Traspaso entre servicios realizado con éxito.' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ==================== MOTOR DE ALERTAS INTELIGENTES & IA REDISTRIBUCIÓN ====================

app.get('/api/inteligencia/alertas-y-sugerencias', autenticar, async (req, res) => {
  const insumos = await dbAll(`SELECT * FROM insumos`);
  const lotes = await dbAll(`
    SELECT l.*, i.nombre as insumo_nombre, i.codigo_barra, i.stock_minimo, i.stock_maximo, u.nombre as ubicacion_nombre
    FROM lotes l
    JOIN insumos i ON l.insumo_id = i.id
    JOIN ubicaciones u ON l.ubicacion_id = u.id
    WHERE l.cantidad > 0
  `);

  const hoy = new Date();
  const alertas = [];
  const sugerenciasRedistribucion = [];

  // 1. Alertas de Vencimiento FEFO (<= 30 días)
  lotes.forEach(l => {
    const venc = new Date(l.fecha_vencimiento);
    const diasRestantes = Math.ceil((venc - hoy) / (1000 * 60 * 60 * 24));
    if (diasRestantes <= 30) {
      alertas.push({
        tipo: diasRestantes <= 0 ? 'VENCIDO' : 'VENCIMIENTO_PROXIMO',
        severidad: 'ALTA',
        mensaje: `Lote ${l.numero_lote} de "${l.insumo_nombre}" en ${l.ubicacion_nombre} vence en ${diasRestantes} días (${l.fecha_vencimiento}).`,
        ubicacion: l.ubicacion_nombre,
        insumo: l.insumo_nombre
      });
    }
  });

  // 2. Alertas de Stock Crítico, Sobrestock y Algoritmo de Redistribución (HU-11, HU-12, HU-15)
  insumos.forEach(ins => {
    const lotesIns = lotes.filter(l => l.insumo_id === ins.id);
    const stockGlobal = lotesIns.reduce((s, l) => s + l.cantidad, 0);

    if (stockGlobal <= ins.stock_minimo) {
      alertas.push({
        tipo: 'STOCK_CRITICO',
        severidad: 'ALTA',
        mensaje: `Stock global crítico para "${ins.nombre}": ${stockGlobal} unid. (Mínimo requerido: ${ins.stock_minimo}).`,
        ubicacion: 'Hospital Global',
        insumo: ins.nombre
      });
    } else if (stockGlobal >= ins.stock_maximo) {
      alertas.push({
        tipo: 'SOBRESTOCK',
        severidad: 'MEDIA',
        mensaje: `Sobrestock detectado para "${ins.nombre}": ${stockGlobal} unid. (Máximo: ${ins.stock_maximo}).`,
        ubicacion: 'Hospital Global',
        insumo: ins.nombre
      });
    }

    // Cruzar unidades con excedente vs unidades con baja disponibilidad
    const porUbicacion = {};
    lotesIns.forEach(l => {
      porUbicacion[l.ubicacion_id] = porUbicacion[l.ubicacion_id] || { id: l.ubicacion_id, nombre: l.ubicacion_nombre, cantidad: 0 };
      porUbicacion[l.ubicacion_id].cantidad += l.cantidad;
    });

    const ubicacionesArr = Object.values(porUbicacion);
    const conExcedente = ubicacionesArr.filter(u => u.cantidad > Math.ceil(ins.stock_minimo * 1.5));
    const conEscasez = ubicacionesArr.filter(u => u.cantidad < Math.ceil(ins.stock_minimo * 0.6));

    conExcedente.forEach(origen => {
      conEscasez.forEach(destino => {
        const sugerido = Math.min(Math.floor(origen.cantidad * 0.3), ins.stock_minimo - destino.cantidad);
        if (sugerido > 0) {
          sugerenciasRedistribucion.push({
            insumo_id: ins.id,
            insumo_nombre: ins.nombre,
            origen_id: origen.id,
            origen_nombre: origen.nombre,
            stock_origen: origen.cantidad,
            destino_id: destino.id,
            destino_nombre: destino.nombre,
            stock_destino: destino.cantidad,
            cantidad_sugerida: sugerido,
            razon: `${origen.nombre} posee excedente (${origen.cantidad} unid.) mientras ${destino.nombre} presenta riesgo de quiebre (${destino.cantidad} unid.).`
          });
        }
      });
    });
  });

  res.json({ alertas, sugerenciasRedistribucion });
});

// HU-16 & HU-17: Solicitudes colaborativas de redistribución
app.get('/api/redistribuciones', autenticar, async (req, res) => {
  const rows = await dbAll(`
    SELECT s.*, i.nombre as insumo_nombre, u1.nombre as origen_nombre, u2.nombre as destino_nombre, us.nombre as solicitante
    FROM solicitudes_redistribucion s
    JOIN insumos i ON s.insumo_id = i.id
    JOIN ubicaciones u1 ON s.ubicacion_origen_id = u1.id
    JOIN ubicaciones u2 ON s.ubicacion_destino_id = u2.id
    JOIN usuarios us ON s.solicitante_id = us.id
    ORDER BY s.creado_en DESC
  `);
  res.json(rows);
});

app.post('/api/redistribuciones', autenticar, async (req, res) => {
  const { insumo_id, ubicacion_origen_id, ubicacion_destino_id, cantidad } = req.body;
  await dbRun(
    `INSERT INTO solicitudes_redistribucion (insumo_id, ubicacion_origen_id, ubicacion_destino_id, cantidad, solicitante_id)
     VALUES (?, ?, ?, ?, ?)`,
    [insumo_id, ubicacion_origen_id, ubicacion_destino_id, cantidad, req.user.id]
  );
  await registrarAuditoria(req.user.email, req.user.rol, 'SOLICITAR_REDISTRIBUCION', 'REDISTRIBUCION', `Solicitud de ${cantidad} unid. insumo ID ${insumo_id}`);
  res.status(201).json({ mensaje: 'Solicitud de redistribución enviada a Jefatura/Bodega.' });
});

app.patch('/api/redistribuciones/:id', autenticar, permitirRoles('TI_ADMIN', 'BODEGA', 'JEFATURA'), async (req, res) => {
  const { estado } = req.body; // 'APROBADA' o 'RECHAZADA'
  const sol = await dbGet(`SELECT * FROM solicitudes_redistribucion WHERE id = ?`, [req.params.id]);
  if (!sol || sol.estado !== 'PENDIENTE') return res.status(400).json({ error: 'Solicitud no válida o ya procesada.' });

  if (estado === 'APROBADA') {
    const lote = await dbGet(
      `SELECT * FROM lotes WHERE insumo_id = ? AND ubicacion_id = ? AND cantidad >= ? ORDER BY fecha_vencimiento ASC LIMIT 1`,
      [sol.insumo_id, sol.ubicacion_origen_id, sol.cantidad]
    );
    if (!lote) return res.status(400).json({ error: 'No hay un lote con stock suficiente en origen para aprobar.' });

    await dbRun(`UPDATE lotes SET cantidad = cantidad - ? WHERE id = ?`, [sol.cantidad, lote.id]);
    const loteDest = await dbGet(
      `SELECT * FROM lotes WHERE insumo_id = ? AND ubicacion_id = ? AND numero_lote = ?`,
      [sol.insumo_id, sol.ubicacion_destino_id, lote.numero_lote]
    );
    if (loteDest) {
      await dbRun(`UPDATE lotes SET cantidad = cantidad + ? WHERE id = ?`, [sol.cantidad, loteDest.id]);
    } else {
      await dbRun(
        `INSERT INTO lotes (insumo_id, ubicacion_id, numero_lote, fecha_ingreso, fecha_elaboracion, fecha_vencimiento, cantidad)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [sol.insumo_id, sol.ubicacion_destino_id, lote.numero_lote, lote.fecha_ingreso, lote.fecha_elaboracion, lote.fecha_vencimiento, sol.cantidad]
      );
    }
    await dbRun(
      `INSERT INTO movimientos (tipo, insumo_id, lote_id, ubicacion_origen_id, ubicacion_destino_id, cantidad, usuario_id, observacion)
       VALUES ('TRASPASO', ?, ?, ?, ?, ?, ?, 'Redistribución colaborativa aprobada')`,
      [sol.insumo_id, lote.id, sol.ubicacion_origen_id, sol.ubicacion_destino_id, sol.cantidad, req.user.id]
    );
  }

  await dbRun(`UPDATE solicitudes_redistribucion SET estado = ?, aprobador_id = ? WHERE id = ?`, [estado, req.user.id, sol.id]);
  await registrarAuditoria(req.user.email, req.user.rol, `REDISTRIBUCION_${estado}`, 'REDISTRIBUCION', `Solicitud #${sol.id} marcada como ${estado}`);
  res.json({ mensaje: `Solicitud ${estado.toLowerCase()} correctamente.` });
});

// ==================== ANALÍTICA, HISTORIAL Y AUDITORÍA INALTERABLE ====================

app.get('/api/analitica', autenticar, async (req, res) => {
  const movimientos = await dbAll(`
    SELECT m.*, i.nombre as insumo_nombre, i.codigo_barra, u1.nombre as origen, u2.nombre as destino, us.nombre as usuario
    FROM movimientos m
    JOIN insumos i ON m.insumo_id = i.id
    LEFT JOIN ubicaciones u1 ON m.ubicacion_origen_id = u1.id
    LEFT JOIN ubicaciones u2 ON m.ubicacion_destino_id = u2.id
    JOIN usuarios us ON m.usuario_id = us.id
    ORDER BY m.fecha DESC LIMIT 100
  `);

  // Proyección de consumo mensual por insumo (HU-18, HU-19)
  const proyeccion = await dbAll(`
    SELECT i.id, i.codigo_barra, i.nombre, i.categoria,
           COALESCE(SUM(CASE WHEN m.tipo = 'CONSUMO' THEN m.cantidad ELSE 0 END), 0) as consumo_historico,
           COALESCE((SELECT SUM(cantidad) FROM lotes WHERE insumo_id = i.id), 0) as stock_actual
    FROM insumos i
    LEFT JOIN movimientos m ON i.id = m.insumo_id
    GROUP BY i.id
  `);

  const proyeccionCalculada = proyeccion.map(p => {
    const demandaProyectada = Math.max(Math.ceil(p.consumo_historico * 1.15), 10);
    const compraSugerida = Math.max(0, demandaProyectada - p.stock_actual);
    return { ...p, demandaProyectada, compraSugerida };
  });

  res.json({ movimientos, proyeccion: proyeccionCalculada });
});

app.get('/api/auditoria', autenticar, async (req, res) => {
  const logs = await dbAll(`SELECT * FROM auditoria ORDER BY id DESC LIMIT 150`);
  res.json(logs);
});

// Iniciar servidor
initDatabase().then(() => {
  app.listen(PORT, () => {
    console.log(`====================================================`);
    console.log(` MediStock Backend + SQLite corriendo en:`);
    console.log(` http://localhost:${PORT}`);
    console.log(`====================================================`);
  });
});
