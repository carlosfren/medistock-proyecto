const { useState, useEffect, useRef } = React;
const API = 'http://localhost:3000/api';

function App() {
  const [token, setToken] = useState(localStorage.getItem('ms_token') || '');
  const [usuario, setUsuario] = useState(() => {
    const u = localStorage.getItem('ms_user');
    return u ? JSON.parse(u) : null;
  });

  // Navegación principal
  const [vista, setVista] = useState('dashboard');

  // Estados de datos
  const [insumos, setInsumos] = useState([]);
  const [ubicaciones, setUbicaciones] = useState([]);
  const [alertasData, setAlertasData] = useState({ alertas: [], sugerenciasRedistribucion: [] });
  const [redistribuciones, setRedistribuciones] = useState([]);
  const [analitica, setAnalitica] = useState({ movimientos: [], proyeccion: [] });
  const [auditoria, setAuditoria] = useState([]);
  const [usuariosLista, setUsuariosLista] = useState([]);

  // Estado Offline-First (HU-05 y HU-06)
  const [modoOffline, setModoOffline] = useState(!navigator.onLine);
  const [colaOffline, setColaOffline] = useState(() => {
    const q = localStorage.getItem('ms_offline_queue');
    return q ? JSON.parse(q) : [];
  });

  const [notificacion, setNotificacion] = useState(null);

  const notificar = (texto, tipo = 'success') => {
    setNotificacion({ texto, tipo });
    setTimeout(() => setNotificacion(null), 4500);
  };

  useEffect(() => {
    const handleOnline = () => setModoOffline(false);
    const handleOffline = () => setModoOffline(true);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    localStorage.setItem('ms_offline_queue', JSON.stringify(colaOffline));
  }, [colaOffline]);

  // Cargar datos cuando hay sesión
  const cargarTodo = async () => {
    if (!token) return;
    const headers = { Authorization: `Bearer ${token}` };
    try {
      const [resIns, resUbi, resAlert, resRed, resAna, resAud] = await Promise.all([
        fetch(`${API}/insumos`, { headers }),
        fetch(`${API}/ubicaciones`, { headers }),
        fetch(`${API}/inteligencia/alertas-y-sugerencias`, { headers }),
        fetch(`${API}/redistribuciones`, { headers }),
        fetch(`${API}/analitica`, { headers }),
        fetch(`${API}/auditoria`, { headers })
      ]);

      if (resIns.status === 401) {
        cerrarSesion();
        return;
      }

      setInsumos(await resIns.json());
      setUbicaciones(await resUbi.json());
      setAlertasData(await resAlert.json());
      setRedistribuciones(await resRed.json());
      setAnalitica(await resAna.json());
      setAuditoria(await resAud.json());

      if (usuario?.rol === 'TI_ADMIN') {
        const resUsr = await fetch(`${API}/usuarios`, { headers });
        if (resUsr.ok) setUsuariosLista(await resUsr.json());
      }
    } catch (e) {
      console.warn('Sin conexión con servidor o modo offline activo');
    }
  };

  useEffect(() => {
    if (token) cargarTodo();
  }, [token]);

  // Sincronización automática de cola offline (HU-06)
  const sincronizarColaOffline = async () => {
    if (colaOffline.length === 0) return;
    let sincronizados = 0;
    const pendientes = [];

    for (const item of colaOffline) {
      try {
        const res = await fetch(`${API}/inventario/consumo`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(item)
        });
        if (res.ok) sincronizados++;
        else pendientes.push(item);
      } catch {
        pendientes.push(item);
      }
    }

    setColaOffline(pendientes);
    if (sincronizados > 0) {
      notificar(`Sincronización completada: ${sincronizados} registros offline enviados al servidor.`);
      cargarTodo();
    }
  };

  useEffect(() => {
    if (!modoOffline && token && colaOffline.length > 0) {
      sincronizarColaOffline();
    }
  }, [modoOffline]);

  const cerrarSesion = () => {
    localStorage.removeItem('ms_token');
    localStorage.removeItem('ms_user');
    setToken('');
    setUsuario(null);
  };

  if (!token || !usuario) {
    return (
      <AuthScreen
        onLoginSuccess={(tk, usr) => {
          localStorage.setItem('ms_token', tk);
          localStorage.setItem('ms_user', JSON.stringify(usr));
          setToken(tk);
          setUsuario(usr);
        }}
      />
    );
  }

  return (
    <div>
      {/* Barra superior */}
      <header className="navbar">
        <div className="nav-brand">
          <strong>MediStock</strong>
          <span className="role-pill">{usuario.rol}</span>
          <span style={{ fontSize: '0.85rem', color: '#cbd5e1' }}>
            {usuario.nombre} ({usuario.ubicacion_nombre || 'Hospital'})
          </span>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <button
            className="btn btn-sm btn-outline"
            onClick={() => setModoOffline(!modoOffline)}
            title="Simular corte/recuperación de red hospitalaria (HU-05 / HU-06)"
          >
            {modoOffline ? '🔴 Modo Offline (Simulado)' : '🟢 En Línea'}
          </button>
          <button className="btn btn-sm btn-danger" onClick={cerrarSesion}>
            Salir
          </button>
        </div>
      </header>

      {/* Banner Offline y Cola de Sincronización */}
      {(modoOffline || colaOffline.length > 0) && (
        <div className="offline-banner">
          <span>
            {modoOffline
              ? '⚠️ Sin conexión de red: Los consumos por escaneo se guardarán en la cola local.'
              : `🔄 Hay ${colaOffline.length} movimiento(s) pendientes en cola local.`}
          </span>
          {!modoOffline && colaOffline.length > 0 && (
            <button className="btn btn-sm btn-primary" onClick={sincronizarColaOffline}>
              Sincronizar Ahora
            </button>
          )}
        </div>
      )}

      {/* Menú de Navegación por Módulos */}
      <nav className="nav-menu">
        <button className={`nav-tab ${vista === 'dashboard' ? 'active' : ''}`} onClick={() => setVista('dashboard')}>
          📊 Stock Multi-Ubicación
        </button>
        <button className={`nav-tab ${vista === 'escaneo' ? 'active' : ''}`} onClick={() => setVista('escaneo')}>
          📷 Consumo / Escaneo FEFO
        </button>
        {(usuario.rol === 'TI_ADMIN' || usuario.rol === 'BODEGA') && (
          <button className={`nav-tab ${vista === 'bodega' ? 'active' : ''}`} onClick={() => setVista('bodega')}>
            📦 Ingreso Bodega y Catálogo
          </button>
        )}
        <button className={`nav-tab ${vista === 'alertas' ? 'active' : ''}`} onClick={() => setVista('alertas')}>
          🚨 Alertas y Redistribución ({alertasData.alertas.length})
        </button>
        <button className={`nav-tab ${vista === 'analitica' ? 'active' : ''}`} onClick={() => setVista('analitica')}>
          📈 Analítica y Proyección
        </button>
        <button className={`nav-tab ${vista === 'auditoria' ? 'active' : ''}`} onClick={() => setVista('auditoria')}>
          🔒 Auditoría Inalterable
        </button>
        {usuario.rol === 'TI_ADMIN' && (
          <button className={`nav-tab ${vista === 'usuarios' ? 'active' : ''}`} onClick={() => setVista('usuarios')}>
            👥 Usuarios y Roles
          </button>
        )}
      </nav>

      <main className="container">
        {notificacion && (
          <div className={`alert-msg ${notificacion.tipo === 'error' ? 'alert-error' : 'alert-success'}`}>
            {notificacion.texto}
          </div>
        )}

        {vista === 'dashboard' && (
          <DashboardView
            insumos={insumos}
            ubicaciones={ubicaciones}
            alertas={alertasData.alertas}
            usuario={usuario}
            token={token}
            onRefresh={cargarTodo}
            notificar={notificar}
          />
        )}

        {vista === 'escaneo' && (
          <EscaneoFEFOView
            insumos={insumos}
            ubicaciones={ubicaciones}
            usuario={usuario}
            token={token}
            modoOffline={modoOffline}
            onSaveOffline={(mov) => {
              setColaOffline([...colaOffline, mov]);
              notificar('Movimiento guardado en cola local (Offline). Se sincronizará al volver la red.', 'success');
            }}
            onRefresh={cargarTodo}
            notificar={notificar}
          />
        )}

        {vista === 'bodega' && (
          <BodegaCatalogoView
            insumos={insumos}
            ubicaciones={ubicaciones}
            token={token}
            onRefresh={cargarTodo}
            notificar={notificar}
          />
        )}

        {vista === 'alertas' && (
          <AlertasRedistribucionView
            alertasData={alertasData}
            redistribuciones={redistribuciones}
            insumos={insumos}
            ubicaciones={ubicaciones}
            usuario={usuario}
            token={token}
            onRefresh={cargarTodo}
            notificar={notificar}
          />
        )}

        {vista === 'analitica' && (
          <AnaliticaView analitica={analitica} />
        )}

        {vista === 'auditoria' && (
          <AuditoriaView auditoria={auditoria} />
        )}

        {vista === 'usuarios' && usuario.rol === 'TI_ADMIN' && (
          <UsuariosView usuarios={usuariosLista} token={token} onRefresh={cargarTodo} notificar={notificar} />
        )}
      </main>
    </div>
  );
}

// ==================== 1. PANTALLA LOGIN Y REGISTRO ====================
function AuthScreen({ onLoginSuccess }) {
  const [tab, setTab] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [nombre, setNombre] = useState('');
  const [rol, setRol] = useState('ENFERMERIA');
  const [ubicacionId, setUbicacionId] = useState(2);
  const [msg, setMsg] = useState(null);

  const handleLogin = async (e) => {
    e.preventDefault();
    setMsg(null);
    try {
      const res = await fetch(`${API}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      const data = await res.json();
      if (!res.ok) return setMsg({ texto: data.error, tipo: 'error' });
      onLoginSuccess(data.token, data.usuario);
    } catch {
      setMsg({ texto: 'No se pudo conectar con el servidor Backend en http://localhost:3000', tipo: 'error' });
    }
  };

  const handleRegistro = async (e) => {
    e.preventDefault();
    setMsg(null);
    try {
      const res = await fetch(`${API}/auth/registro`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nombre, email, password, rol, ubicacion_asignada_id: ubicacionId })
      });
      const data = await res.json();
      if (!res.ok) return setMsg({ texto: data.error, tipo: 'error' });
      setMsg({ texto: data.mensaje, tipo: 'success' });
      setTab('login');
    } catch {
      setMsg({ texto: 'Error de red al registrar.', tipo: 'error' });
    }
  };

  const autocompletar = (mail) => {
    setEmail(mail);
    setPassword('123456');
  };

  return (
    <div className="auth-container">
      <div className="auth-card">
        <div className="brand-header">
          <div className="brand-icon">MS</div>
          <h2>MediStock Hospital</h2>
          <p style={{ color: '#64748b', fontSize: '0.9rem' }}>
            Trazabilidad y Gestión Inteligente de Insumos Clínicos
          </p>
        </div>

        <div className="tabs-auth">
          <button className={tab === 'login' ? 'active' : ''} onClick={() => setTab('login')}>
            Iniciar Sesión
          </button>
          <button className={tab === 'registro' ? 'active' : ''} onClick={() => setTab('registro')}>
            Registrarse
          </button>
        </div>

        {msg && <div className={`alert-msg ${msg.tipo === 'error' ? 'alert-error' : 'alert-success'}`}>{msg.texto}</div>}

        {tab === 'login' ? (
          <form onSubmit={handleLogin}>
            <div className="form-group">
              <label>Correo Institucional</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="usuario@medistock.cl" />
            </div>
            <div className="form-group">
              <label>Contraseña</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required placeholder="••••••" />
            </div>
            <button type="submit" className="btn btn-primary btn-block">Ingresar al Sistema</button>

            <div className="demo-box">
              <strong>Accesos rápidos por Rol (Clave: 123456):</strong><br />
              <button type="button" className="btn btn-sm btn-outline" onClick={() => autocompletar('admin@medistock.cl')}>Admin TI</button>
              <button type="button" className="btn btn-sm btn-outline" onClick={() => autocompletar('bodega@medistock.cl')}>Bodega</button>
              <button type="button" className="btn btn-sm btn-outline" onClick={() => autocompletar('enfermeria@medistock.cl')}>Enfermería</button>
              <button type="button" className="btn btn-sm btn-outline" onClick={() => autocompletar('jefatura@medistock.cl')}>Jefatura</button>
            </div>
          </form>
        ) : (
          <form onSubmit={handleRegistro}>
            <div className="form-group">
              <label>Nombre y Apellido</label>
              <input type="text" value={nombre} onChange={(e) => setNombre(e.target.value)} required placeholder="Ej. Dra. Camila Soto" />
            </div>
            <div className="form-group">
              <label>Correo Institucional</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="camila@medistock.cl" />
            </div>
            <div className="form-group">
              <label>Contraseña (mínimo 6 caracteres)</label>
              <input type="password" minLength="6" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </div>
            <div className="form-group">
              <label>Rol en el Hospital (RBAC)</label>
              <select value={rol} onChange={(e) => setRol(e.target.value)}>
                <option value="ENFERMERIA">Personal de Enfermería / Clínico</option>
                <option value="BODEGA">Encargado de Bodega Central</option>
                <option value="JEFATURA">Jefatura de Servicio</option>
                <option value="TI_ADMIN">Administrador TI</option>
              </select>
            </div>
            <div className="form-group">
              <label>Servicio / Ubicación Principal</label>
              <select value={ubicacionId} onChange={(e) => setUbicacionId(e.target.value)}>
                <option value="1">Bodega Central Hospital</option>
                <option value="2">Servicio de Urgencias</option>
                <option value="3">Pabellón Quirúrgico</option>
                <option value="4">Botiquín Hospitalización Piso 2</option>
              </select>
            </div>
            <button type="submit" className="btn btn-primary btn-block">Crear Cuenta</button>
          </form>
        )}
      </div>
    </div>
  );
}

// ==================== 2. DASHBOARD MULTI-UBICACIÓN (HU-07, HU-08, HU-09) ====================
function DashboardView({ insumos, ubicaciones, alertas, usuario, token, onRefresh, notificar }) {
  const [busqueda, setBusqueda] = useState('');
  const [filtroUbicacion, setFiltroUbicacion] = useState('');
  const [traspasoModal, setTraspasoModal] = useState(null);
  const [destinoId, setDestinoId] = useState('');
  const [cantidadTraspaso, setCantidadTraspaso] = useState(1);

  const filtrados = insumos.filter((i) => {
    const matchTexto = i.nombre.toLowerCase().includes(busqueda.toLowerCase()) || i.codigo_barra.includes(busqueda);
    if (!filtroUbicacion) return matchTexto;
    return matchTexto && i.lotes.some((l) => String(l.ubicacion_id) === String(filtroUbicacion));
  });

  const totalUnidades = insumos.reduce((acc, i) => acc + i.stockTotal, 0);
  const valorInventario = insumos.reduce((acc, i) => acc + i.stockTotal * i.precio_unitario, 0);

  // HU-09: Exportar inventario a CSV
  const exportarCSV = () => {
    const filas = [['Codigo_Barra', 'Insumo', 'Categoria', 'Ubicacion', 'Lote', 'Fecha_Ingreso', 'Fecha_Vencimiento', 'Cantidad']];
    insumos.forEach((i) => {
      i.lotes.forEach((l) => {
        filas.push([i.codigo_barra, i.nombre, i.categoria, l.ubicacion_nombre, l.numero_lote, l.fecha_ingreso, l.fecha_vencimiento, l.cantidad]);
      });
    });
    const csvContent = 'data:text/csv;charset=utf-8,' + filas.map((e) => e.join(',')).join('\n');
    const link = document.createElement('a');
    link.setAttribute('href', encodeURI(csvContent));
    link.setAttribute('download', `inventario_medistock_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  const ejecutarTraspaso = async (e) => {
    e.preventDefault();
    const res = await fetch(`${API}/inventario/traspaso`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        lote_id: traspasoModal.id,
        ubicacion_destino_id: destinoId,
        cantidad: cantidadTraspaso
      })
    });
    const data = await res.json();
    if (!res.ok) return notificar(data.error, 'error');
    notificar(data.mensaje);
    setTraspasoModal(null);
    onRefresh();
  };

  return (
    <div>
      <div className="kpi-grid">
        <div className="card kpi-card">
          <div className="kpi-title">Insumos en Catálogo</div>
          <div className="kpi-num">{insumos.length}</div>
        </div>
        <div className="card kpi-card success">
          <div className="kpi-title">Stock Total Hospital</div>
          <div className="kpi-num">{totalUnidades} unid.</div>
        </div>
        <div className="card kpi-card danger">
          <div className="kpi-title">Alertas Activas (FEFO / Crítico)</div>
          <div className="kpi-num">{alertas.length}</div>
        </div>
        <div className="card kpi-card warning">
          <div className="kpi-title">Valorización Inventario</div>
          <div className="kpi-num">${valorInventario.toLocaleString('es-CL')}</div>
        </div>
      </div>

      <div className="card">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', justifyContent: 'space-between', marginBottom: '1rem' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', flex: 1 }}>
            <input
              style={{ maxWidth: '300px' }}
              placeholder="🔍 Buscar por código de barras o nombre..."
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
            />
            <select style={{ maxWidth: '240px' }} value={filtroUbicacion} onChange={(e) => setFiltroUbicacion(e.target.value)}>
              <option value="">Todas las ubicaciones del hospital</option>
              {ubicaciones.map((u) => (
                <option key={u.id} value={u.id}>{u.nombre}</option>
              ))}
            </select>
          </div>
          <button className="btn btn-outline" onClick={exportarCSV}>📥 Exportar CSV</button>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Código</th>
                <th>Insumo Clínico</th>
                <th>Stock Global</th>
                <th>Desglose por Ubicación y Lote (FEFO)</th>
              </tr>
            </thead>
            <tbody>
              {filtrados.map((ins) => (
                <tr key={ins.id}>
                  <td><code>{ins.codigo_barra}</code></td>
                  <td>
                    <strong>{ins.nombre}</strong><br />
                    <small style={{ color: '#64748b' }}>{ins.categoria} • {ins.unidad_medida}</small>
                  </td>
                  <td>
                    <strong>{ins.stockTotal}</strong> / mín. {ins.stock_minimo}{' '}
                    {ins.stockTotal <= ins.stock_minimo ? (
                      <span className="badge badge-crit">Crítico</span>
                    ) : (
                      <span className="badge badge-ok">Óptimo</span>
                    )}
                  </td>
                  <td>
                    {ins.lotes.length === 0 ? (
                      <span style={{ color: '#94a3b8' }}>Sin stock disponible</span>
                    ) : (
                      ins.lotes
                        .filter((l) => !filtroUbicacion || String(l.ubicacion_id) === String(filtroUbicacion))
                        .map((l) => (
                          <div key={l.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.3rem 0', borderBottom: '1px dashed #e2e8f0' }}>
                            <span>
                              <span className="badge badge-info">{l.ubicacion_nombre}</span>{' '}
                              <strong>{l.cantidad} unid.</strong> — Lote: <code>{l.numero_lote}</code> (Vence: {l.fecha_vencimiento})
                            </span>
                            {(usuario.rol === 'TI_ADMIN' || usuario.rol === 'BODEGA' || usuario.rol === 'JEFATURA') && (
                              <button
                                className="btn btn-sm btn-outline"
                                onClick={() => {
                                  setTraspasoModal(l);
                                  setCantidadTraspaso(1);
                                  setDestinoId('');
                                }}
                              >
                                Traspasar
                              </button>
                            )}
                          </div>
                        ))
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal Traspaso Directo */}
      {traspasoModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
          <div className="card" style={{ width: '100%', maxWidth: '420px' }}>
            <h3>Traspasar Lote {traspasoModal.numero_lote}</h3>
            <p style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: '1rem' }}>
              Origen: <strong>{traspasoModal.ubicacion_nombre}</strong> (Disponible: {traspasoModal.cantidad})
            </p>
            <form onSubmit={ejecutarTraspaso}>
              <div className="form-group">
                <label>Ubicación de Destino</label>
                <select required value={destinoId} onChange={(e) => setDestinoId(e.target.value)}>
                  <option value="">Seleccione servicio destino...</option>
                  {ubicaciones
                    .filter((u) => u.id !== traspasoModal.ubicacion_id)
                    .map((u) => (
                      <option key={u.id} value={u.id}>{u.nombre}</option>
                    ))}
                </select>
              </div>
              <div className="form-group">
                <label>Cantidad a transferir</label>
                <input type="number" min="1" max={traspasoModal.cantidad} value={cantidadTraspaso} onChange={(e) => setCantidadTraspaso(e.target.value)} required />
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                <button type="button" className="btn btn-outline" onClick={() => setTraspasoModal(null)}>Cancelar</button>
                <button type="submit" className="btn btn-primary">Confirmar Traspaso</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// ==================== 3. CONSUMO POR ESCANEO Y FEFO (HU-01, HU-02, HU-05) ====================
function EscaneoFEFOView({ insumos, ubicaciones, usuario, token, modoOffline, onSaveOffline, onRefresh, notificar }) {
  const [codigoBarra, setCodigoBarra] = useState('7801001001');
  const [ubicacionId, setUbicacionId] = useState(usuario.ubicacion_asignada_id || 2);
  const [cantidad, setCantidad] = useState(1);
  const [observacion, setObservacion] = useState('');
  const [camaraActiva, setCamaraActiva] = useState(false);
  const scannerRef = useRef(null);

  const insumoSeleccionado = insumos.find((i) => i.codigo_barra === codigoBarra.trim());
  const lotesOrdenadosFEFO = insumoSeleccionado
    ? insumoSeleccionado.lotes.filter((l) => String(l.ubicacion_id) === String(ubicacionId))
    : [];

  const iniciarCamara = () => {
    setCamaraActiva(true);
    setTimeout(() => {
      if (window.Html5Qrcode) {
        const html5QrCode = new window.Html5Qrcode('qr-reader');
        scannerRef.current = html5QrCode;
        html5QrCode
          .start(
            { facingMode: 'environment' },
            { fps: 10, qrbox: { width: 250, height: 150 } },
            (decodedText) => {
              setCodigoBarra(decodedText);
              detenerCamara();
              notificar(`Código leído por cámara: ${decodedText}`);
            },
            () => {}
          )
          .catch(() => {
            notificar('No se detectó cámara disponible en este equipo. Puedes ingresar o seleccionar el código.', 'error');
            setCamaraActiva(false);
          });
      }
    }, 200);
  };

  const detenerCamara = () => {
    if (scannerRef.current) {
      scannerRef.current.stop().catch(() => {});
    }
    setCamaraActiva(false);
  };

  const registrarConsumo = async (e) => {
    e.preventDefault();
    const payload = {
      codigo_barra: codigoBarra.trim(),
      ubicacion_id: ubicacionId,
      cantidad,
      observacion,
      fecha_offline: modoOffline ? new Date().toISOString() : null
    };

    if (modoOffline) {
      onSaveOffline(payload);
      setObservacion('');
      return;
    }

    const res = await fetch(`${API}/inventario/consumo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) return notificar(data.error, 'error');
    notificar(data.mensaje);
    setObservacion('');
    onRefresh();
  };

  return (
    <div className="grid-2">
      <div className="card">
        <h3>📷 Registro Ágil de Consumo Clínico (Escaneo)</h3>
        <p style={{ fontSize: '0.88rem', color: '#64748b', marginBottom: '1rem' }}>
          Escanea el código de barras/QR con la cámara o selecciona el producto. El sistema descontará automáticamente del lote que vence primero (<strong>FEFO</strong>).
        </p>

        <div style={{ marginBottom: '1rem' }}>
          {!camaraActiva ? (
            <button type="button" className="btn btn-outline btn-block" onClick={iniciarCamara}>
              📸 Activar Cámara para Escanear Código
            </button>
          ) : (
            <div>
              <div id="qr-reader"></div>
              <button type="button" className="btn btn-danger btn-block" onClick={detenerCamara}>
                Detener Cámara
              </button>
            </div>
          )}
        </div>

        <form onSubmit={registrarConsumo}>
          <div className="form-group">
            <label>Servicio donde se utiliza el insumo</label>
            <select value={ubicacionId} onChange={(e) => setUbicacionId(e.target.value)}>
              {ubicaciones.map((u) => (
                <option key={u.id} value={u.id}>{u.nombre}</option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label>Código de Barras / QR del Insumo</label>
            <input value={codigoBarra} onChange={(e) => setCodigoBarra(e.target.value)} required placeholder="Escanea o escribe el código..." />
            <small style={{ color: '#64748b' }}>
              Acceso rápido:{' '}
              {insumos.map((i) => (
                <button
                  key={i.id}
                  type="button"
                  className="btn btn-sm btn-outline"
                  style={{ margin: '2px' }}
                  onClick={() => setCodigoBarra(i.codigo_barra)}
                >
                  {i.codigo_barra} ({i.nombre.split(' ')[0]})
                </button>
              ))}
            </small>
          </div>

          <div className="form-group">
            <label>Cantidad Consumida</label>
            <input type="number" min="1" value={cantidad} onChange={(e) => setCantidad(e.target.value)} required />
          </div>

          <div className="form-group">
            <label>Observación / Box / Procedimiento (Opcional)</label>
            <input value={observacion} onChange={(e) => setObservacion(e.target.value)} placeholder="Ej. Atención Box 3 Urgencias" />
          </div>

          <button type="submit" className="btn btn-primary btn-block">
            {modoOffline ? '💾 Guardar Consumo en Cola Offline' : '✅ Registrar Consumo (Aplicar FEFO)'}
          </button>
        </form>
      </div>

      <div className="card">
        <h3>🔍 Prioridad FEFO (First Expired, First Out)</h3>
        {insumoSeleccionado ? (
          <div>
            <p style={{ marginBottom: '0.75rem' }}>
              Insumo detectado: <strong>{insumoSeleccionado.nombre}</strong>
            </p>
            {lotesOrdenadosFEFO.length === 0 ? (
              <div className="alert-msg alert-error">
                No hay lotes disponibles de este insumo en la ubicación seleccionada. Revisa la pestaña de Redistribución.
              </div>
            ) : (
              <div>
                <p style={{ fontSize: '0.85rem', color: '#0369a1', marginBottom: '0.75rem' }}>
                  Orden sugerido de extracción en este servicio:
                </p>
                {lotesOrdenadosFEFO.map((l, idx) => (
                  <div
                    key={l.id}
                    style={{
                      padding: '0.75rem',
                      border: idx === 0 ? '2px solid #0284c7' : '1px solid #e2e8f0',
                      borderRadius: '8px',
                      marginBottom: '0.5rem',
                      background: idx === 0 ? '#f0f9ff' : '#fff'
                    }}
                  >
                    {idx === 0 && <span className="badge badge-info">USAR PRIMERO (FEFO)</span>}
                    <div style={{ marginTop: '0.25rem' }}>
                      <strong>Lote: {l.numero_lote}</strong> — Stock: <strong>{l.cantidad} unid.</strong>
                    </div>
                    <small style={{ color: '#475569' }}>
                      Elaboración: {l.fecha_elaboracion} | Vencimiento: <strong>{l.fecha_vencimiento}</strong>
                    </small>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <p style={{ color: '#64748b' }}>Ingresa o escanea un código de barras válido para ver la sugerencia FEFO.</p>
        )}
      </div>
    </div>
  );
}

// ==================== 4. INGRESO A BODEGA Y CATÁLOGO (HU-03, HU-24) ====================
function BodegaCatalogoView({ insumos, ubicaciones, token, onRefresh, notificar }) {
  // Form ingreso lote
  const [insumoId, setInsumoId] = useState(insumos[0]?.id || 1);
  const [ubicacionId, setUbicacionId] = useState(1);
  const [numeroLote, setNumeroLote] = useState('');
  const [fechaElab, setFechaElab] = useState('2026-08-01');
  const [fechaVenc, setFechaVenc] = useState('2027-08-01');
  const [cantidad, setCantidad] = useState(20);

  // Form nuevo insumo catálogo
  const [codigo, setCodigo] = useState('');
  const [nombre, setNombre] = useState('');
  const [categoria, setCategoria] = useState('Insumos Clínicos');
  const [unidad, setUnidad] = useState('Unidad');
  const [minimo, setMinimo] = useState(15);
  const [maximo, setMaximo] = useState(100);
  const [precio, setPrecio] = useState(2500);

  const registrarIngreso = async (e) => {
    e.preventDefault();
    const res = await fetch(`${API}/inventario/ingreso`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        insumo_id: insumoId,
        ubicacion_id: ubicacionId,
        numero_lote: numeroLote,
        fecha_elaboracion: fechaElab,
        fecha_vencimiento: fechaVenc,
        cantidad
      })
    });
    const data = await res.json();
    if (!res.ok) return notificar(data.error, 'error');
    notificar(data.mensaje);
    setNumeroLote('');
    onRefresh();
  };

  const crearInsumo = async (e) => {
    e.preventDefault();
    const res = await fetch(`${API}/insumos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        codigo_barra: codigo,
        nombre,
        categoria,
        unidad_medida: unidad,
        stock_minimo: minimo,
        stock_maximo: maximo,
        precio_unitario: precio
      })
    });
    const data = await res.json();
    if (!res.ok) return notificar(data.error, 'error');
    notificar(data.mensaje);
    setCodigo('');
    setNombre('');
    onRefresh();
  };

  return (
    <div className="grid-2">
      <div className="card">
        <h3>📥 Recepción / Ingreso de Lote a Bodega (HU-03)</h3>
        <form onSubmit={registrarIngreso}>
          <div className="form-group">
            <label>Insumo Clínico</label>
            <select value={insumoId} onChange={(e) => setInsumoId(e.target.value)}>
              {insumos.map((i) => (
                <option key={i.id} value={i.id}>{i.codigo_barra} - {i.nombre}</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label>Ubicación de Recepción</label>
            <select value={ubicacionId} onChange={(e) => setUbicacionId(e.target.value)}>
              {ubicaciones.map((u) => (
                <option key={u.id} value={u.id}>{u.nombre}</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label>Número de Lote *</label>
            <input required value={numeroLote} onChange={(e) => setNumeroLote(e.target.value)} placeholder="Ej. LOT-2026-99" />
          </div>
          <div className="grid-2">
            <div className="form-group">
              <label>Fecha Elaboración *</label>
              <input type="date" required value={fechaElab} onChange={(e) => setFechaElab(e.target.value)} />
            </div>
            <div className="form-group">
              <label>Fecha Vencimiento *</label>
              <input type="date" required value={fechaVenc} onChange={(e) => setFechaVenc(e.target.value)} />
            </div>
          </div>
          <div className="form-group">
            <label>Cantidad Ingresada *</label>
            <input type="number" min="1" required value={cantidad} onChange={(e) => setCantidad(e.target.value)} />
          </div>
          <button type="submit" className="btn btn-primary btn-block">Registrar Ingreso con Trazabilidad</button>
        </form>
      </div>

      <div className="card">
        <h3>🗂️ Nuevo Producto en Catálogo Maestro (HU-24)</h3>
        <form onSubmit={crearInsumo}>
          <div className="form-group">
            <label>Código de Barras / QR *</label>
            <input required value={codigo} onChange={(e) => setCodigo(e.target.value)} placeholder="Ej. 7801001099" />
          </div>
          <div className="form-group">
            <label>Nombre del Insumo Clínico *</label>
            <input required value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej. Mascarilla N95 Clínica" />
          </div>
          <div className="grid-2">
            <div className="form-group">
              <label>Categoría</label>
              <input required value={categoria} onChange={(e) => setCategoria(e.target.value)} />
            </div>
            <div className="form-group">
              <label>Unidad de Medida</label>
              <input required value={unidad} onChange={(e) => setUnidad(e.target.value)} />
            </div>
          </div>
          <div className="grid-2">
            <div className="form-group">
              <label>Stock Mínimo (Alerta)</label>
              <input type="number" min="1" required value={minimo} onChange={(e) => setMinimo(e.target.value)} />
            </div>
            <div className="form-group">
              <label>Stock Máximo (Sobrestock)</label>
              <input type="number" min="1" required value={maximo} onChange={(e) => setMaximo(e.target.value)} />
            </div>
          </div>
          <div className="form-group">
            <label>Precio Unitario ($ CLP)</label>
            <input type="number" min="0" required value={precio} onChange={(e) => setPrecio(e.target.value)} />
          </div>
          <button type="submit" className="btn btn-success btn-block">Guardar en Catálogo</button>
        </form>
      </div>
    </div>
  );
}

// ==================== 5. ALERTAS Y REDISTRIBUCIÓN IA (HU-10..17) ====================
function AlertasRedistribucionView({ alertasData, redistribuciones, insumos, ubicaciones, usuario, token, onRefresh, notificar }) {
  const [insumoId, setInsumoId] = useState(insumos[0]?.id || 1);
  const [origenId, setOrigenId] = useState(1);
  const [destinoId, setDestinoId] = useState(2);
  const [cantidad, setCantidad] = useState(5);

  const crearSolicitud = async (payload) => {
    const res = await fetch(`${API}/redistribuciones`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) return notificar(data.error, 'error');
    notificar(data.mensaje);
    onRefresh();
  };

  const responderSolicitud = async (id, estado) => {
    const res = await fetch(`${API}/redistribuciones/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ estado })
    });
    const data = await res.json();
    if (!res.ok) return notificar(data.error, 'error');
    notificar(data.mensaje);
    onRefresh();
  };

  return (
    <div>
      <div className="grid-2">
        <div className="card">
          <h3>🚨 Motor de Alertas Preventivas (FEFO y Stock)</h3>
          {alertasData.alertas.length === 0 ? (
            <p style={{ color: '#059669' }}>Sin alertas críticas actualmente.</p>
          ) : (
            alertasData.alertas.map((a, idx) => (
              <div key={idx} className={`alert-msg ${a.severidad === 'ALTA' ? 'alert-error' : 'alert-success'}`}>
                <strong>[{a.tipo}]</strong> {a.mensaje}
              </div>
            ))
          )}
        </div>

        <div className="card">
          <h3>🤖 Algoritmo de Redistribución Inteligente (HU-15)</h3>
          <p style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: '0.75rem' }}>
            Cruza servicios con sobrestock vs unidades en riesgo de quiebre para evitar vencimientos y desabastecimiento.
          </p>
          {alertasData.sugerenciasRedistribucion.length === 0 ? (
            <p style={{ color: '#64748b' }}>No hay desbalances críticos que requieran redistribución inmediata.</p>
          ) : (
            alertasData.sugerenciasRedistribucion.map((s, idx) => (
              <div key={idx} style={{ border: '1px solid #bae6fd', background: '#f0f9ff', padding: '0.85rem', borderRadius: '8px', marginBottom: '0.6rem' }}>
                <strong>{s.insumo_nombre}</strong>
                <p style={{ fontSize: '0.85rem', margin: '0.3rem 0' }}>{s.razon}</p>
                <button
                  className="btn btn-sm btn-primary"
                  onClick={() =>
                    crearSolicitud({
                      insumo_id: s.insumo_id,
                      ubicacion_origen_id: s.origen_id,
                      ubicacion_destino_id: s.destino_id,
                      cantidad: s.cantidad_sugerida
                    })
                  }
                >
                  Solicitar Traspaso de {s.cantidad_sugerida} unid. ({s.origen_nombre} → {s.destino_nombre})
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <h3>📨 Solicitar Insumos a Otro Servicio (HU-16)</h3>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              crearSolicitud({ insumo_id: insumoId, ubicacion_origen_id: origenId, ubicacion_destino_id: destinoId, cantidad });
            }}
          >
            <div className="form-group">
              <label>Insumo Requerido</label>
              <select value={insumoId} onChange={(e) => setInsumoId(e.target.value)}>
                {insumos.map((i) => <option key={i.id} value={i.id}>{i.nombre}</option>)}
              </select>
            </div>
            <div className="grid-2">
              <div className="form-group">
                <label>Desde (Origen)</label>
                <select value={origenId} onChange={(e) => setOrigenId(e.target.value)}>
                  {ubicaciones.map((u) => <option key={u.id} value={u.id}>{u.nombre}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Hacia (Destino)</label>
                <select value={destinoId} onChange={(e) => setDestinoId(e.target.value)}>
                  {ubicaciones.map((u) => <option key={u.id} value={u.id}>{u.nombre}</option>)}
                </select>
              </div>
            </div>
            <div className="form-group">
              <label>Cantidad</label>
              <input type="number" min="1" value={cantidad} onChange={(e) => setCantidad(e.target.value)} />
            </div>
            <button type="submit" className="btn btn-primary btn-block">Enviar Solicitud</button>
          </form>
        </div>

        <div className="card">
          <h3>📋 Gestión y Aprobación de Redistribuciones (HU-17)</h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Insumo</th>
                  <th>Ruta</th>
                  <th>Cant.</th>
                  <th>Estado</th>
                  <th>Acción</th>
                </tr>
              </thead>
              <tbody>
                {redistribuciones.map((r) => (
                  <tr key={r.id}>
                    <td>{r.insumo_nombre}</td>
                    <td>{r.origen_nombre} → {r.destino_nombre}</td>
                    <td><strong>{r.cantidad}</strong></td>
                    <td>
                      <span className={`badge ${r.estado === 'APROBADA' ? 'badge-ok' : r.estado === 'RECHAZADA' ? 'badge-crit' : 'badge-warn'}`}>
                        {r.estado}
                      </span>
                    </td>
                    <td>
                      {r.estado === 'PENDIENTE' && (usuario.rol === 'TI_ADMIN' || usuario.rol === 'BODEGA' || usuario.rol === 'JEFATURA') ? (
                        <div style={{ display: 'flex', gap: '4px' }}>
                          <button className="btn btn-sm btn-success" onClick={() => responderSolicitud(r.id, 'APROBADA')}>✔</button>
                          <button className="btn btn-sm btn-danger" onClick={() => responderSolicitud(r.id, 'RECHAZADA')}>✖</button>
                        </div>
                      ) : (
                        <small style={{ color: '#64748b' }}>-</small>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

// ==================== 6. ANALÍTICA Y PROYECCIÓN DE COMPRAS (HU-18, HU-19) ====================
function AnaliticaView({ analitica }) {
  return (
    <div>
      <div className="card">
        <h3>📈 Proyección de Necesidades Mensuales y Planificación de Compras (HU-19)</h3>
        <p style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: '1rem' }}>
          Cálculo predictivo basado en el consumo histórico por servicio (+15% margen de seguridad clínica).
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Código</th>
                <th>Insumo Clínico</th>
                <th>Consumo Histórico</th>
                <th>Stock Actual</th>
                <th>Demanda Proyectada Mes</th>
                <th>Compra Sugerida</th>
              </tr>
            </thead>
            <tbody>
              {analitica.proyeccion.map((p) => (
                <tr key={p.id}>
                  <td><code>{p.codigo_barra}</code></td>
                  <td><strong>{p.nombre}</strong></td>
                  <td>{p.consumo_historico} unid.</td>
                  <td>{p.stock_actual} unid.</td>
                  <td><strong>{p.demandaProyectada} unid.</strong></td>
                  <td>
                    {p.compraSugerida > 0 ? (
                      <span className="badge badge-warn">Comprar {p.compraSugerida} unid.</span>
                    ) : (
                      <span className="badge badge-ok">Stock Cubierto</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h3>🕒 Historial de Movimientos Clínicos (HU-18)</h3>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Tipo</th>
                <th>Insumo</th>
                <th>Cantidad</th>
                <th>Origen / Destino</th>
                <th>Usuario</th>
              </tr>
            </thead>
            <tbody>
              {analitica.movimientos.map((m) => (
                <tr key={m.id}>
                  <td><small>{m.fecha}</small></td>
                  <td><span className="badge badge-info">{m.tipo}</span></td>
                  <td>{m.insumo_nombre}</td>
                  <td><strong>{m.cantidad}</strong></td>
                  <td>{m.origen || '-'} → {m.destino || 'Paciente'}</td>
                  <td>{m.usuario}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ==================== 7. AUDITORÍA INALTERABLE (HU-22) ====================
function AuditoriaView({ auditoria }) {
  return (
    <div className="card">
      <h3>🔒 Registro de Auditoría Inalterable (SQLite Triggers Activos)</h3>
      <p style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: '1rem' }}>
        Protegido a nivel de motor SQLite mediante triggers <code>BEFORE UPDATE</code> y <code>BEFORE DELETE</code> que bloquean cualquier alteración histórica.
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Fecha / Hora</th>
              <th>Usuario</th>
              <th>Rol</th>
              <th>Acción</th>
              <th>Detalle</th>
            </tr>
          </thead>
          <tbody>
            {auditoria.map((a) => (
              <tr key={a.id}>
                <td>#{a.id}</td>
                <td><small>{a.fecha_hora}</small></td>
                <td>{a.usuario_email}</td>
                <td><span className="badge badge-info">{a.rol}</span></td>
                <td><strong>{a.accion}</strong></td>
                <td>{a.detalle}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ==================== 8. GESTIÓN DE USUARIOS Y ROLES (HU-25) ====================
function UsuariosView({ usuarios, token, onRefresh, notificar }) {
  const cambiarRol = async (id, nuevoRol) => {
    const res = await fetch(`${API}/usuarios/${id}/rol`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ rol: nuevoRol })
    });
    if (res.ok) {
      notificar('Rol actualizado correctamente.');
      onRefresh();
    }
  };

  return (
    <div className="card">
      <h3>👥 Administración de Usuarios y Control de Acceso (RBAC)</h3>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Correo</th>
              <th>Ubicación</th>
              <th>Rol Asignado</th>
            </tr>
          </thead>
          <tbody>
            {usuarios.map((u) => (
              <tr key={u.id}>
                <td><strong>{u.nombre}</strong></td>
                <td>{u.email}</td>
                <td>{u.ubicacion || 'General'}</td>
                <td>
                  <select value={u.rol} onChange={(e) => cambiarRol(u.id, e.target.value)} style={{ maxWidth: '200px' }}>
                    <option value="TI_ADMIN">TI_ADMIN</option>
                    <option value="BODEGA">BODEGA</option>
                    <option value="ENFERMERIA">ENFERMERIA</option>
                    <option value="JEFATURA">JEFATURA</option>
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
