document.addEventListener('DOMContentLoaded', () => {
    // --- API Helper ---
    const API_URL = window.location.protocol === 'file:'
        ? 'http://127.0.0.1:5000/api'
        : '/api';

    let allPatients = [];
    let allTreatments = [];
    let allAppointments = [];
    let lastSelectedPatientName = '';
    let currentDate = new Date();
    let editingPatientId = null;
    let editingTreatmentId = null;
    let editingRoomId = null;
    let editingProfessionalId = null;
    let editingInventoryId = null;
    let editingAppointmentId = null;
    let allInventory = [];
    let allConsentDocuments = [];
    let allUsers = [];
    let editingUserId = null;
    let allUnbilledAppointments = [];
    let allInvoices = [];
    let dashboardRevenueData = { 'diaria': '0.00 €', 'semanal': '0.00 €', 'mensual': '0.00 €', 'anual': '0.00 €' };
    let currentCalendarView = 'cards';
    let appointmentFilters = {
        id_profesional: '',
        id_sala: '',
        id_tratamiento: '',
        paciente: '',
        fecha_desde: '',
        fecha_hasta: ''
    };

    async function fetchApi(endpoint, method = 'GET', data = null) {
        if (window.isGuestMode) {
            console.log('Guest mode intercept:', method, endpoint);
            if (method === 'GET') {
                if (endpoint.includes('/patients')) return [{ id: 1, nombre: 'Juan', apellidos: 'Pérez', email: 'juan@example.com', telefono: '600123456' }, { id: 2, nombre: 'María', apellidos: 'Gómez', email: 'maria@example.com', telefono: '600654321' }];
                if (endpoint.includes('/treatments')) return [{ id: 1, nombre: 'Limpieza Dental', precio: 50 }, { id: 2, nombre: 'Empaste', precio: 80 }];
                if (endpoint.includes('/appointments')) {
                    const today = new Date().toISOString().split('T')[0];
                    return [
                        { id: 1, paciente_nombre: 'Juan', paciente_apellidos: 'Pérez', fecha: today, hora: '10:00', estado: 'Programada', tratamiento_nombre: 'Limpieza Dental' },
                        { id: 2, paciente_nombre: 'María', paciente_apellidos: 'Gómez', fecha: today, hora: '11:30', estado: 'Programada', tratamiento_nombre: 'Empaste' }
                    ];
                }
                if (endpoint.includes('/inventory')) return [{ id: 1, nombre_producto: 'Guantes de látex', cantidad: 100, nivel_de_reposicion: 20 }, { id: 2, nombre_producto: 'Anestesia', cantidad: 50, nivel_de_reposicion: 10 }];
                if (endpoint.includes('/rooms')) return [{ id: 1, nombre: 'Sala 1', color_asociado: '#3b82f6' }, { id: 2, nombre: 'Sala 2', color_asociado: '#10b981' }];
                if (endpoint.includes('/professionals')) return [{ id: 1, nombre: 'Dr. García', rol: 'doctor' }, { id: 2, nombre: 'Dra. López', rol: 'doctor' }];
                if (endpoint.includes('/consent')) return [];
                if (endpoint.includes('/users')) return [{ id: 1, username: 'invitado', rol: 'admin' }];
                if (endpoint.includes('/billing/stats')) return { porFacturar: {amount: 0, count: 0}, pendienteCobro: {amount:0, count:0}, cobradoHoy: {amount:0, count:0}, facturadoMes: {amount:0, count:0} };
                if (endpoint.includes('/appointments/unbilled')) return [];
                if (endpoint.includes('/invoices')) return [];
                if (endpoint.includes('/presupuestos')) return [];
                if (endpoint.includes('/admin/clinics')) return [{ id: 1, nombre: 'Clínica Demo (Invitado)', db_name: 'demo' }];
                if (endpoint.includes('/clinic')) return { nombre: 'Clínica Demo (Invitado)' };
                if (endpoint.includes('/schedule')) return [];
                return [];
            } else {
                if (endpoint.includes('/login')) return { status: 'success', user: { username: 'invitado', rol: 'admin' }, token: 'mock-token' };
                return { status: 'success' };
            }
        }

        const options = {
            method,
            headers: { 'Content-Type': 'application/json' }
        };

        const activeClinicDb = localStorage.getItem('dentia_active_clinic_db');
        if (activeClinicDb) {
            options.headers['X-Clinic-DB'] = activeClinicDb;
        }

        const activeClinicId = localStorage.getItem('dentia_active_clinic_id');
        if (activeClinicId) {
            options.headers['X-Clinic-ID'] = activeClinicId;
        } else {
            // Include id_clinica from currentUser if available
            const storedUser = localStorage.getItem('dentia_user');
            if (storedUser) {
                const user = JSON.parse(storedUser);
                if (user.id_clinica) {
                    options.headers['X-Clinic-ID'] = user.id_clinica;
                }
            }
        }
        
        const token = localStorage.getItem('dentia_token');
        if (token) {
            options.headers['Authorization'] = `Bearer ${token}`;
        }

        if (data) options.body = JSON.stringify(data);

        try {
            const response = await fetch(`${API_URL}${endpoint}`, options);
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                const errMsg = errorData.message || `HTTP error! status: ${response.status}`;
                
                if (response.status === 401) {
                    localStorage.removeItem('dentia_user');
                    localStorage.removeItem('dentia_token');
                    currentUser = null;
                    
                    // Show login modal
                    const loginModal = document.getElementById('loginModal');
                    if (loginModal) {
                        loginModal.classList.remove('hidden');
                    }
                    console.warn("Sesión expirada o token inválido. Redirigiendo a inicio de sesión.");
                }
                
                throw new Error(errMsg);
            }
            const result = await response.json();
            return result;
        } catch (error) {
            console.error(`Error fetching ${endpoint}:`, error);
            // Don't show annoying alerts for auth token expiration, let the login screen handle it
            if (error.message !== 'Invalid token' && error.message !== 'Token missing') {
                alert(`Error en la conexión o en el servidor: ${error.message}`);
            }
            return null;
        }
    }

    // --- Auth & Session Management ---
    const PERMISSIONS_BY_ROLE = {
        'super-admin': ['*'],
        'admin': ['dashboard', 'pacientes', 'calendario', 'sala-espera', 'simulador', 'tratamientos', 'inventario', 'consentimiento', 'facturacion', 'usuarios', 'configuracion'],
        'doctor': ['dashboard', 'pacientes', 'calendario', 'sala-espera', 'simulador', 'tratamientos', 'consentimiento'],
        'higienista': ['dashboard', 'pacientes', 'calendario', 'sala-espera', 'simulador'],
        'recepcionista': ['dashboard', 'pacientes', 'calendario', 'sala-espera', 'facturacion', 'consentimiento'],
        'asistente': ['dashboard', 'pacientes', 'calendario', 'sala-espera', 'inventario'],
        'paciente': ['dashboard', 'calendario']
    };

    let currentUser = null; // { username, role } or null

    function checkAuth() {
        const stored = localStorage.getItem('dentia_user');
        if (stored) {
            currentUser = JSON.parse(stored);
            return true;
        }
        return false;
    }

    function hasPermission(target) {
        if (!currentUser) return false;
        const role = (currentUser.rol || currentUser.role || '').toLowerCase();
        const permissions = PERMISSIONS_BY_ROLE[role] || [];
        return permissions.includes('*') || permissions.includes(target);
    }

    function updateUIBasedOnAuth() {
        const isLoggedIn = !!currentUser;
        const isGuest = !isLoggedIn;

        // Update User Profile in Header
        const userNameEl = document.getElementById('userName');
        const userRoleEl = document.getElementById('userRole');
        const userAvatarEl = document.querySelector('.avatar');

        if (isLoggedIn && currentUser) {
            const name = currentUser.nombre_completo || currentUser.username || 'Usuario';
            const role = currentUser.rol || currentUser.role || 'Rol';
            if (userNameEl) userNameEl.innerText = name;
            if (userRoleEl) {
                userRoleEl.innerText = role;
                userRoleEl.style.display = 'inline-block';
            }
            if (userAvatarEl) userAvatarEl.innerText = name.charAt(0).toUpperCase();
        } else {
            if (userNameEl) userNameEl.innerText = 'Invitado';
            if (userRoleEl) userRoleEl.style.display = 'none';
            if (userAvatarEl) userAvatarEl.innerText = 'G';
        }

        // Show/Hide Sidebar Items based on permissions
        document.querySelectorAll('.nav-item').forEach(item => {
            const target = item.getAttribute('data-target');
            if (!target) return; // Skip items without target (like login/logout)

            if (isLoggedIn) {
                item.style.display = hasPermission(target) ? 'flex' : 'none';
            } else {
                // If not logged in, only show dashboard and calendario (publicly available in guest mode)
                const publicTargets = ['dashboard', 'calendario'];
                item.style.display = publicTargets.includes(target) ? 'flex' : 'none';
            }
        });

        // Toggle creation buttons visibility based on permissions
        // addPatientBtn -> pacientes
        // newAppointmentBtn -> calendario
        // newTreatmentBtn -> tratamientos
        // addInventoryBtn -> inventario
        const actionPermissions = {
            'addPatientBtn': 'pacientes',
            'newAppointmentBtn': 'calendario',
            'newTreatmentBtn': 'tratamientos',
            'addInventoryBtn': 'inventario'
        };

        Object.entries(actionPermissions).forEach(([id, permission]) => {
            const btn = document.getElementById(id);
            if (btn) {
                btn.style.display = (isLoggedIn && hasPermission(permission)) ? 'flex' : 'none';
            }
        });

        // Toggle Login/Logout buttons
        const logoutBtn = document.getElementById('logoutBtn');
        const loginBtn = document.getElementById('loginBtn');

        if (logoutBtn) logoutBtn.style.display = isLoggedIn ? 'flex' : 'none';
        if (loginBtn) loginBtn.style.display = !isLoggedIn ? 'flex' : 'none';

        // Show/hide clinic manager button
        const manageClinicsBtn = document.getElementById('manageClinicsBtn');
        if (manageClinicsBtn) {
            const role = (currentUser && (currentUser.rol || currentUser.role)) || '';
            const isSuperAdmin = isLoggedIn && role.toLowerCase() === 'super-admin';
            manageClinicsBtn.classList.toggle('hidden', !isSuperAdmin);

            // Proactively ensure the button is visible if it should be
            if (isSuperAdmin) {
                manageClinicsBtn.style.display = 'flex';
            } else {
                manageClinicsBtn.style.display = 'none';
            }
        }
    }

    // --- Initialization & Data Loading ---
    async function initApp() {
        // Auth Check & UI Update
        if (checkAuth()) {
            updateUIBasedOnAuth();
            document.getElementById('loginModal').classList.add('hidden');
            
            // Load data since user is authenticated
            loadDropdowns();
            loadPatients();
            loadTreatments();
            loadAppointments();
            loadInventory();
            if (typeof loadClinicInfo === 'function') loadClinicInfo();
            setupSearchListeners();
            updateWeekDisplay();
        } else {
            // If not logged in and not explicitly in guest mode, show the modal
            if (!window.isGuestMode) {
                document.getElementById('loginModal').classList.remove('hidden');
            } else {
                updateUIBasedOnAuth();
                document.getElementById('loginModal').classList.add('hidden');
                
                // Load allowed data for guest mode
                loadDropdowns();
                loadPatients();
                loadTreatments();
                loadAppointments();
                loadInventory();
                if (typeof loadClinicInfo === 'function') loadClinicInfo();
                setupSearchListeners();
                updateWeekDisplay();
            }
        }
    }

    // Login/Logout Handlers
    const loginForm = document.getElementById('loginForm');
    const guestLoginBtn = document.getElementById('guestLoginBtn');
    const logoutBtn = document.getElementById('logoutBtn');
    const loginBtn = document.getElementById('loginBtn');

    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const data = Object.fromEntries(new FormData(loginForm).entries());

            // Simple validation for demo purposes or real API call
            // Using existing /api/login endpoint from app.py
            const res = await fetchApi('/login', 'POST', data);

            if (res && res.status === 'success') {
                currentUser = res.user;
                localStorage.setItem('dentia_user', JSON.stringify(currentUser));
                if (res.token) {
                    localStorage.setItem('dentia_token', res.token);
                }

                // If the user has a clinic associated, set it as active
                if (currentUser.id_clinica) {
                    // We might want to fetch the db_name too, but for now ID is enough for Supabase
                    // localStorage.setItem('dentia_active_clinic_db', ...);
                }

                window.isGuestMode = false;

                document.getElementById('loginModal').classList.add('hidden');
                updateUIBasedOnAuth();

                // Load all data
                loadPatients();
                loadTreatments();
                loadAppointments();
                loadInventory();
                setupSearchListeners();
                updateWeekDisplay();
            } else {
                alert('Credenciales incorrectas');
            }
        });
    }

    if (guestLoginBtn) {
        guestLoginBtn.addEventListener('click', () => {
            currentUser = null;
            window.isGuestMode = true;
            document.getElementById('loginModal').classList.add('hidden');
            updateUIBasedOnAuth();

            // Load allowed data
            loadPatients(); // Need patients for calendar view names
            loadTreatments();
            loadAppointments();
            loadInventory();
            setupSearchListeners();
            updateWeekDisplay();
        });
    }

    if (logoutBtn) {
        logoutBtn.addEventListener('click', (e) => {
            e.preventDefault();
            localStorage.removeItem('dentia_user');
            localStorage.removeItem('dentia_token');
            currentUser = null;
            window.isGuestMode = false;
            window.location.reload();
        });
    }

    if (loginBtn) {
        loginBtn.addEventListener('click', (e) => {
            e.preventDefault();
            document.getElementById('loginModal').classList.remove('hidden');
        });
    }

    async function loadDropdowns() {
        const treatments = await fetchApi('/treatments');
        const professionals = await fetchApi('/professionals');
        const rooms = await fetchApi('/rooms');

        const treatmentSelects = document.querySelectorAll('select[name="id_tratamiento"]');
        const professionalSelects = document.querySelectorAll('select[name="id_profesional"]');
        const salaSelects = document.querySelectorAll('select[name="id_sala"]');

        if (treatments) {
            treatmentSelects.forEach(select => {
                const placeholder = select.querySelector('option[disabled], option[value=""]');
                select.innerHTML = '';
                if (placeholder) select.appendChild(placeholder);
                treatments.forEach(t => {
                    const opt = document.createElement('option');
                    opt.value = t.id;
                    opt.textContent = t.nombre;
                    select.appendChild(opt);
                });
            });
        }

        if (professionals) {
            professionalSelects.forEach(select => {
                const placeholder = select.querySelector('option[disabled], option[value=""]');
                select.innerHTML = '';
                if (placeholder) select.appendChild(placeholder);
                professionals.forEach(p => {
                    const opt = document.createElement('option');
                    opt.value = p.id;
                    opt.textContent = p.nombre;
                    select.appendChild(opt);
                });
            });
        }

        if (rooms) {
            salaSelects.forEach(select => {
                const placeholder = select.querySelector('option[disabled], option[value=""]');
                select.innerHTML = '';
                if (placeholder) select.appendChild(placeholder);
                rooms.forEach(s => {
                    const opt = document.createElement('option');
                    opt.value = s.id;
                    opt.textContent = s.nombre;
                    select.appendChild(opt);
                });
            });
        }
    }

    async function loadPatients() {
        const patients = await fetchApi('/patients');
        allPatients = patients || [];
        renderPatients(allPatients);
        updateDashboardMetrics();
    }

    async function loadTreatments() {
        allTreatments = await fetchApi('/treatments') || [];
        renderTreatments(allTreatments);
    }

    async function loadAppointments() {
        allAppointments = await fetchApi('/appointments') || [];
        renderAppointments();
        updateDashboardMetrics();
    }

    async function loadInventory() {
        allInventory = await fetchApi('/inventory') || [];
        renderInventory(allInventory);
        updateDashboardMetrics(); // Update dashboard alert
    }

    async function loadRooms() {
        const rooms = await fetchApi('/rooms');
        renderRooms(rooms || []);
    }

    async function loadTeam() {
        const team = await fetchApi('/professionals');
        renderTeam(team || []);
    }

    async function loadConsentDocuments() {
        allConsentDocuments = await fetchApi('/consent') || [];
        renderConsentDocuments(allConsentDocuments);
    }

    // Global functions for consent documents (assuming these are defined elsewhere or will be)
    // window.submitDocument = submitDocument;
    // window.deleteDocument = deleteDocument;
    // window.refreshDocuments = refreshDocuments;

    // ==========================================
    // Clinic Manager (Super-Admin) Support
    // ==========================================
    window.openClinicManager = function () {
        const modal = document.getElementById('clinicManagerModal');
        if (modal) {
            modal.classList.remove('hidden');
            loadAllClinics();
        }
    };

    window.closeClinicManager = function () {
        const modal = document.getElementById('clinicManagerModal');
        if (modal) modal.classList.add('hidden');
        window.hideNewClinicForm();
    };

    window.showNewClinicForm = function () {
        document.getElementById('newClinicFormContainer').classList.remove('hidden');
    };

    window.hideNewClinicForm = function () {
        document.getElementById('newClinicFormContainer').classList.add('hidden');
        document.getElementById('newClinicForm').reset();
    };
    async function loadAllClinics() {
        const list = document.getElementById('clinicsList');
        if (!list) return;
        list.innerHTML = '<div class="spinner"></div>';

        const clinics = await fetchApi('/admin/clinics');

        if (clinics) {
            list.innerHTML = '';
            if (clinics.length === 0) {
                list.innerHTML = '<p style="text-align:center; padding: 1rem; color: var(--text-secondary);">No hay clínicas registradas.</p>';
                return;
            }

            clinics.forEach(c => {
                const el = document.createElement('div');
                el.className = 'appointment-card';
                el.innerHTML = `
                    <div class="appointment-header">
                        <h4>${c.nombre}</h4>
                    </div>
                    <div class="appointment-details">
                        <p><i class="fa-solid fa-database"></i> DB: ${c.db_name}</p>
                        ${c.cif ? `<p><i class="fa-solid fa-id-card"></i> CIF: ${c.cif}</p>` : ''}
                    </div>
                    <!-- Action to switch context -->
                    <button class="btn-secondary" style="margin-top:0.5rem; font-size:0.8rem;" onclick="window.switchClinicContext('${c.db_name}', '${c.nombre}', ${c.id})">Cambiar a esta clínica</button>
                `;
                list.appendChild(el);
            });
        } else {
            list.innerHTML = '<p style="color:var(--danger-color);">Error al cargar clínicas o permisos insuficientes.</p>';
        }
    }

    window.submitNewClinic = async function () {
        const formData = new FormData(document.getElementById('newClinicForm'));
        const data = {
            nombre: formData.get('nc_nombre'),
            cif: formData.get('nc_cif'),
            telefono: formData.get('nc_telefono')
        };

        if (!data.nombre) {
            alert("El nombre es requerido.");
            return;
        }

        const res = await fetchApi('/admin/clinics', 'POST', data);

        if (res && res.status === 'success') {
            alert("Clínica creada y base de datos inicializada exitosamente.");
            window.hideNewClinicForm();
            loadAllClinics();
        } else {
            alert(`Error al crear la clínica.`);
        }
    };

    window.switchClinicContext = function (db_name, nombre, clinic_id) {
        if (confirm(`¿Cambiar entorno de trabajo a ${nombre}?`)) {
            localStorage.setItem('dentia_active_clinic_db', db_name);
            if (clinic_id) {
                localStorage.setItem('dentia_active_clinic_id', clinic_id);
            } else {
                localStorage.removeItem('dentia_active_clinic_id');
            }
            alert(`Entorno cambiado a ${nombre}. La página se recargará.`);
            window.location.reload();
        }
    };

    async function loadUsers() {
        allUsers = await fetchApi('/users') || [];
        renderUsers(allUsers);
    }

    // --- Billing Functions ---
    async function loadBillingData() {
        fetchBillingStats();
        // Default to first sub-tab
        const activeTab = document.querySelector('.billing-tab-btn.active');
        const target = activeTab ? activeTab.getAttribute('data-billing-target') : 'citas-completadas';
        
        if (target === 'citas-completadas') loadUnbilledAppointments();
        else loadInvoices();
    }

    async function fetchBillingStats() {
        const stats = await fetchApi('/billing/stats');
        if (stats) {
            renderBillingStats(stats);
        }
    }

    async function loadUnbilledAppointments() {
        const data = await fetchApi('/appointments/unbilled');
        allUnbilledAppointments = data || [];
        renderFilteredUnbilledAppointments();
    }

    async function loadInvoices() {
        const data = await fetchApi('/invoices');
        allInvoices = data || [];
        renderFilteredInvoices();
    }

    function renderBillingStats(stats) {
        const mapping = {
            'porFacturar': stats.porFacturar,
            'pendienteCobro': stats.pendienteCobro,
            'cobradoHoy': stats.cobradoHoy,
            'facturadoMes': stats.facturadoMes
        };

        for (const [id, data] of Object.entries(mapping)) {
            const card = document.querySelector(`.billing-stat-card[data-stat="${id}"]`);
            if (card) {
                const amountEl = card.querySelector('.stat-amount');
                const countEl = card.querySelector('.stat-count');
                if (amountEl) amountEl.innerText = `${data.amount.toFixed(2)}€`;
                if (countEl) countEl.innerText = `${data.count} ${id === 'porFacturar' ? 'citas' : 'facturas'}`;
            }
        }
    }

    window.loadPresupuestos = async () => {
        const tableBody = document.getElementById('presupuestosTableBody');
        if (tableBody) tableBody.innerHTML = '<tr><td colspan="6" class="loading">Cargando presupuestos...</td></tr>';

        const presupuestos = await fetchApi('/presupuestos');
        if (presupuestos) {
            renderPresupuestos(presupuestos);
        }
    };

    function renderPresupuestos(presupuestos) {
        const tableBody = document.getElementById('presupuestosTableBody');
        if (!tableBody) return;

        const filter = document.getElementById('filterPresupuestoStatus').value;
        const searchInput = document.getElementById('searchPresupuestos');
        const search = searchInput ? searchInput.value.toLowerCase() : '';

        const filtered = presupuestos.filter(p => {
            const matchesStatus = filter === 'all' || p.estado === filter;
            const matchesSearch = p.numero_presupuesto.toLowerCase().includes(search) || 
                                 p.paciente_nombre_completo.toLowerCase().includes(search);
            return matchesStatus && matchesSearch;
        });

        if (filtered.length === 0) {
            tableBody.innerHTML = '<tr><td colspan="6" class="no-data" style="text-align: center; padding: 2rem;">No se encontraron presupuestos.</td></tr>';
            return;
        }

        tableBody.innerHTML = filtered.map(p => `
            <tr>
                <td><strong>${p.numero_presupuesto}</strong></td>
                <td>${p.fecha}</td>
                <td>${p.paciente_nombre_completo}</td>
                <td><div style="font-weight: 700;">${p.total}€</div></td>
                <td><span class="status-badge status-${p.estado === 'Aceptado' ? 'completed' : (p.estado === 'Rechazado' ? 'cancelled' : 'pending')}">${p.estado}</span></td>
                <td>
                    <div style="display: flex; gap: 0.4rem;">
                        <button class="btn-icon" onclick="downloadPresupuestoPdf(${p.id})" title="Ver PDF" style="color: #0ea5e9; background: #e0f2fe;"><i class="fa-solid fa-file-pdf"></i></button>
                        ${p.estado === 'Borrador' || p.estado === 'Enviado' ? `
                            <button class="btn-icon" onclick="changePresupuestoStatus(${p.id}, 'Aceptado')" title="Aceptar" style="color: #10b981; background: #ecfdf5;"><i class="fa-solid fa-check"></i></button>
                            <button class="btn-icon" onclick="changePresupuestoStatus(${p.id}, 'Rechazado')" title="Rechazar" style="color: #ef4444; background: #fee2e2;"><i class="fa-solid fa-times"></i></button>
                        ` : ''}
                        <button class="btn-icon" onclick="deletePresupuesto(${p.id})" title="Eliminar" style="color: #64748b; background: #f1f5f9;"><i class="fa-solid fa-trash"></i></button>
                    </div>
                </td>
            </tr>
        `).join('');
    }

    function renderUnbilledAppointments(data) {
        const list = document.getElementById('unbilled-appointments-list');
        if (!list) return;

        if (data.length === 0) {
            list.innerHTML = '<tr><td colspan="5" class="empty-table-msg">No hay citas completadas pendientes de facturar.</td></tr>';
            return;
        }

        list.innerHTML = data.map(item => `
            <tr>
                <td>
                    <div style="font-weight: 600;">${item.paciente_nombre_completo}</div>
                    <div style="font-size: 0.75rem; color: var(--secondary-color);">${item.fecha} ${item.hora.substring(0,5)}</div>
                </td>
                <td>${item.tratamiento_nombre}</td>
                <td><div class="treatment-price">${item.precio}€</div></td>
                <td><span class="status-badge status-completed">Completada</span></td>
                <td>
                    <div style="display: flex; gap: 0.4rem;">
                        <button class="btn-primary" onclick="generateInvoice(${item.id}, ${item.id_paciente}, ${item.precio})" style="padding: 0.4rem 0.8rem; font-size: 0.8rem;">
                            <i class="fa-solid fa-file-invoice-dollar"></i> Facturar
                        </button>
                        <button class="btn-secondary" onclick="markAsCharged(${item.id})" style="padding: 0.4rem 0.8rem; font-size: 0.8rem; background: #ecfdf5; color: #10b981; border-color: #10b981;">
                            <i class="fa-solid fa-cash-register"></i> Cobrar
                        </button>
                    </div>
                </td>
            </tr>
        `).join('');
    }

    function renderInvoices(data) {
        const list = document.getElementById('invoices-list');
        if (!list) return;

        if (data.length === 0) {
            list.innerHTML = '<tr><td colspan="6" class="empty-table-msg">No se han emitido facturas todavía.</td></tr>';
            return;
        }

        list.innerHTML = data.map(inv => `
            <tr>
                <td>
                    <div style="font-weight: 700; color: var(--primary-color);">${inv.numero_factura}</div>
                    <div style="font-size: 0.75rem; color: var(--secondary-color);">${inv.fecha}</div>
                </td>
                <td>${inv.paciente_nombre_completo}</td>
                <td><div style="font-weight: 700;">${inv.total}€</div></td>
                <td><span class="category-tag">${inv.metodo_pago}</span></td>
                <td><span class="status-badge status-${inv.estado === 'Pagada' ? 'completed' : (inv.estado === 'Anulada' ? 'cancelled' : 'pending')}">${inv.estado}</span></td>
                <td>
                    <div style="display: flex; gap: 0.4rem;">
                        <button class="btn-icon" onclick="downloadInvoicePdf(${inv.id})" title="Ver PDF" style="color: #ef4444; background: #fee2e2;"><i class="fa-solid fa-file-pdf"></i></button>
                        ${inv.estado === 'Emitida' ? `
                            <button class="btn-icon" onclick="markAsPaid(${inv.id})" title="Marcar como Pagada" style="color: #10b981; background: #ecfdf5;">
                                <i class="fa-solid fa-check"></i>
                            </button>
                        ` : ''}
                        ${inv.estado !== 'Anulada' ? `
                            <button class="btn-icon" onclick="cancelInvoice(${inv.id})" title="Anular Factura" style="color: #64748b; background: #f1f5f9;">
                                <i class="fa-solid fa-ban"></i>
                            </button>
                        ` : ''}
                    </div>
                </td>
            </tr>
        `).join('');
    }

    function renderFilteredUnbilledAppointments() {
        const searchInput = document.getElementById('billingSearchUnbilled');
        const searchTerm = searchInput ? searchInput.value.toLowerCase() : '';
        
        const filtered = allUnbilledAppointments.filter(item => {
            const matchesSearch = !searchTerm || 
                item.paciente_nombre_completo.toLowerCase().includes(searchTerm) ||
                item.tratamiento_nombre.toLowerCase().includes(searchTerm);
            return matchesSearch;
        });
        
        renderUnbilledAppointments(filtered);
        
        // Update count badge
        const countEl = document.getElementById('unbilledCount');
        if (countEl) countEl.innerText = filtered.length;
    }

    function renderFilteredInvoices() {
        const searchInput = document.getElementById('billingSearchInvoices');
        const statusFilter = document.getElementById('invoiceStatusFilter');
        const dateFromInput = document.getElementById('invoiceDateFrom');
        const dateToInput = document.getElementById('invoiceDateTo');
        
        const searchTerm = searchInput ? searchInput.value.toLowerCase() : '';
        const status = statusFilter ? statusFilter.value.toLowerCase() : 'todos';
        const dateFrom = dateFromInput ? dateFromInput.value : '';
        const dateTo = dateToInput ? dateToInput.value : '';
        
        const filtered = allInvoices.filter(inv => {
            const matchesSearch = !searchTerm || 
                inv.numero_factura.toLowerCase().includes(searchTerm) ||
                inv.paciente_nombre_completo.toLowerCase().includes(searchTerm);
            const matchesStatus = status === 'todos' || inv.estado.toLowerCase() === status;
            const matchesDate = (!dateFrom || inv.fecha >= dateFrom) && (!dateTo || inv.fecha <= dateTo);
            
            return matchesSearch && matchesStatus && matchesDate;
        });
        
        renderInvoices(filtered);
        
        // Update count badge
        const countEl = document.getElementById('invoicesTotalCount');
        if (countEl) countEl.innerText = filtered.length;
    }

    // Attach Billing Listeners
    const billingSearchUnbilled = document.getElementById('billingSearchUnbilled');
    if (billingSearchUnbilled) {
        billingSearchUnbilled.addEventListener('input', renderFilteredUnbilledAppointments);
    }

    const billingSearchInvoices = document.getElementById('billingSearchInvoices');
    const invoiceStatusFilter = document.getElementById('invoiceStatusFilter');
    const invoiceDateFrom = document.getElementById('invoiceDateFrom');
    const invoiceDateTo = document.getElementById('invoiceDateTo');

    if (billingSearchInvoices) billingSearchInvoices.addEventListener('input', renderFilteredInvoices);
    if (invoiceStatusFilter) invoiceStatusFilter.addEventListener('change', renderFilteredInvoices);
    if (invoiceDateFrom) invoiceDateFrom.addEventListener('change', renderFilteredInvoices);
    if (invoiceDateTo) invoiceDateTo.addEventListener('change', renderFilteredInvoices);

    window.generateInvoice = async (apptId, patientId, total) => {
        document.getElementById('invoiceApptId').value = apptId;
        document.getElementById('invoicePatientId').value = patientId;
        document.getElementById('invoiceTotal').value = total;
        document.getElementById('invoicePaymentMethod').value = 'Efectivo';
        document.getElementById('invoiceIvaPercent').value = '0';
        document.getElementById('invoiceNotes').value = '';
        document.getElementById('generateInvoiceModal').classList.remove('hidden');
    };

    const generateInvoiceForm = document.getElementById('generateInvoiceForm');
    if (generateInvoiceForm) {
        generateInvoiceForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const apptId = document.getElementById('invoiceApptId').value;
            const patientId = document.getElementById('invoicePatientId').value;
            const total = document.getElementById('invoiceTotal').value;
            const paymentMethod = document.getElementById('invoicePaymentMethod').value;
            const ivaPercent = document.getElementById('invoiceIvaPercent').value;
            const notes = document.getElementById('invoiceNotes').value;

            const res = await fetchApi('/invoices', 'POST', {
                id_cita: apptId,
                id_paciente: patientId,
                total: parseFloat(total),
                iva_percent: parseFloat(ivaPercent),
                metodo_pago: paymentMethod,
                notas: notes
            });

            if (res && res.status === 'success') {
                alert('Factura generada correctamente: ' + res.data.numero_factura);
                document.getElementById('generateInvoiceModal').classList.add('hidden');
                loadUnbilledAppointments();
                fetchBillingStats();
                loadInvoices(); // Refresh the issued invoices table too if the tab is clicked later
            }
        });
    }

    window.markAsCharged = async (apptId) => {
        if (!confirm('¿Marcar esta cita como cobrada?')) return;
        
        const res = await fetchApi(`/appointments/${apptId}/cobrado`, 'PATCH', { cobrado: true });
        if (res && res.status === 'success') {
            loadUnbilledAppointments();
            fetchBillingStats();
            loadAppointments();
            loadInvoices(); // Refresh invoices since one was automatically generated
        }
    };

    window.markAsPaid = async (invoiceId) => {
        if (!confirm('¿Marcar factura como pagada?')) return;
        
        const res = await fetchApi(`/invoices/${invoiceId}/pay`, 'PATCH');
        if (res && res.status === 'success') {
            loadInvoices();
            fetchBillingStats();
        }
    };

    window.cancelInvoice = async (invoiceId) => {
        if (!confirm('¿Estás seguro de que deseas ANULAR esta factura? Esta acción marcará la cita como no cobrada de nuevo.')) return;
        
        const res = await fetchApi(`/invoices/${invoiceId}/cancel`, 'PATCH');
        if (res && res.status === 'success') {
            loadInvoices();
            fetchBillingStats();
            loadUnbilledAppointments();
        }
    };

    window.downloadInvoicePdf = async (invoiceId) => {
        try {
            // Fetch complete invoice details
            const data = await fetchApi(`/invoices/${invoiceId}`);
            if (!data || data.status !== 'success') {
                alert('Error al cargar los detalles de la factura.');
                return;
            }

            const inv = data.invoice;
            const pat = data.patient;
            const clinic = data.clinic;
            const appt = data.appointment;
            const treat = data.treatment;

            // Populate the hidden template
            document.getElementById('pdfClinicName').textContent = clinic.nombre || 'Clínica Dental';
            document.getElementById('pdfClinicAddress').textContent = clinic.direccion || 'Dirección de la clínica';
            document.getElementById('pdfClinicPhone').textContent = clinic.telefono || '';
            document.getElementById('pdfClinicEmail').textContent = clinic.email || '';
            document.getElementById('pdfClinicCif').textContent = clinic.cif || '';

            document.getElementById('pdfInvoiceNumber').textContent = inv.numero_factura;
            document.getElementById('pdfInvoiceDate').textContent = inv.fecha;

            document.getElementById('pdfPatientName').textContent = pat.nombre ? `${pat.nombre} ${pat.apellidos || ''}` : 'Paciente desconocido';
            document.getElementById('pdfPatientDni').textContent = `DNI: ${pat.dni || 'No especificado'}`;
            let addressParts = [pat.calle, pat.numero_calle, pat.municipio, pat.poblacion_provincia].filter(Boolean);
            document.getElementById('pdfPatientAddress').textContent = addressParts.join(', ') || 'Dirección no especificada';

            document.getElementById('pdfPaymentMethod').textContent = inv.metodo_pago || 'No especificado';
            document.getElementById('pdfPaymentStatus').textContent = inv.estado;
            document.getElementById('pdfPaymentStatus').style.color = inv.estado === 'Pagada' ? '#10b981' : '#f59e0b';

            document.getElementById('pdfTreatmentName').textContent = treat.nombre || 'Tratamiento Dental General';
            document.getElementById('pdfTreatmentPrice').textContent = `${inv.total} €`;
            
            document.getElementById('pdfBaseImponible').textContent = `${(inv.base_imponible || inv.total).toFixed(2)} €`;
            document.getElementById('pdfIvaPercentLabel').textContent = inv.iva_percent || '0';
            document.getElementById('pdfIvaImporte').textContent = `${(inv.iva_importe || 0).toFixed(2)} €`;
            document.getElementById('pdfTotalAmount').textContent = `${inv.total} €`;

            const notesEl = document.getElementById('pdfNotes');
            const notesContainerEl = document.getElementById('pdfNotesContainer');
            if (inv.notas) {
                notesEl.textContent = inv.notas;
                notesContainerEl.style.display = 'block';
            } else {
                notesContainerEl.style.display = 'none';
            }

            // Generate PDF from the template element
            const element = document.getElementById('invoicePdfTemplate');
            element.style.display = 'block'; // Temporarily show to render

            const opt = {
                margin:       10,
                filename:     `${inv.numero_factura}.pdf`,
                image:        { type: 'jpeg', quality: 0.98 },
                html2canvas:  { scale: 2 },
                jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' }
            };

            await html2pdf().set(opt).from(element).save();

            element.style.display = 'none'; // Hide again
        } catch (error) {
            console.error('Error al generar PDF:', error);
            alert('Ocurrió un error al intentar generar el PDF.');
        }
    };

    function updateDashboardMetrics() {
        // 1. Total Patients
        const totalPatients = allPatients.length;
        const totalPatientsEl = document.getElementById('totalPatientsValue');
        if (totalPatientsEl) totalPatientsEl.innerText = totalPatients;

        // 2. New Patients (this month)
        const now = new Date();
        const currentMonth = now.getMonth();
        const currentYear = now.getFullYear();
        const newPatients = allPatients.filter(p => {
            if (!p.fecha_registro) return false;
            const regDate = new Date(p.fecha_registro);
            return regDate.getMonth() === currentMonth && regDate.getFullYear() === currentYear;
        }).length;
        const newPatientsEl = document.getElementById('newPatientsValue');
        if (newPatientsEl) newPatientsEl.innerText = newPatients;

        // 3. Appointments Today
        const todayStr = now.toISOString().split('T')[0];
        const apptsToday = allAppointments.filter(a => a.fecha === todayStr).length;
        const apptsTodayEl = document.getElementById('appointmentsTodayValue');
        if (apptsTodayEl) apptsTodayEl.innerText = apptsToday;

        // 4. Cancellation Rate
        const totalAppts = allAppointments.length;
        const cancelledAppts = allAppointments.filter(a => a.estado === 'cancelada').length;
        let cancelRate = 0;
        if (totalAppts > 0) {
            cancelRate = (cancelledAppts / totalAppts) * 100;
        }
        const cancelRateEl = document.getElementById('cancelRateValue');
        if (cancelRateEl) cancelRateEl.innerText = `${cancelRate.toFixed(1)}%`;

        // 5. Low Stock Alert
        const lowStockItems = allInventory.filter(item => item.cantidad <= (item.nivel_de_reposicion || 5));
        const lowStockSection = document.getElementById('lowStockDashboardSection');
        const lowStockList = document.getElementById('lowStockList');

        if (lowStockSection && lowStockList) {
            if (lowStockItems.length > 0) {
                lowStockSection.style.display = 'block';
                lowStockList.innerHTML = lowStockItems.map(item => `
                    <div class="glass" style="padding: 1rem; border-radius: 12px; border-left: 4px solid #f59e0b; display: flex; justify-content: space-between; align-items: center;">
                        <div>
                            <div style="font-weight: 700; color: #0f172a; font-size: 0.95rem;">${item.nombre_producto}</div>
                            <div style="font-size: 0.8rem; color: var(--secondary-color);">${item.categoria}</div>
                        </div>
                        <div style="text-align: right;">
                            <div style="font-weight: 800; color: #ef4444;">${item.cantidad}</div>
                            <div style="font-size: 0.7rem; color: #94a3b8;">Cantidad: ${item.unidades}</div>
                        </div>
                    </div>
                `).join('');
            } else {
                lowStockSection.style.display = 'none';
            }
        }
        
        // 5. Waiting Room Stats
        const waitingAppts = allAppointments.filter(a => a.estado === 'en_espera' && a.fecha === todayStr);
        const waitingCountEl = document.querySelector('#sala-espera-view .stat-card.glass .stat-value');
        if (waitingCountEl) waitingCountEl.innerText = waitingAppts.length;

        // Waiting room next patient logic
        const nextPatientContainer = document.querySelector('#sala-espera-view .glass:last-child');
        if (nextPatientContainer && waitingAppts.length > 0) {
            // Sort by time or arrival (here by time as simple proxy)
            waitingAppts.sort((a, b) => a.hora.localeCompare(b.hora));
            const next = waitingAppts[0];
            
            nextPatientContainer.innerHTML = `
                <h3 style="color: var(--secondary-color); font-size: 1.25rem; margin-bottom: 1rem;">Próximo Paciente</h3>
                <div style="font-size: 3rem; font-weight: 800; color: #0f172a; margin-bottom: 0.5rem; text-transform: uppercase;">
                    ${next.paciente_nombre.substring(0,1)}.${next.paciente_apellidos.substring(0,1)}.
                </div>
                <div style="font-size: 1.1rem; color: var(--primary-color); font-weight: 500;">
                    ${next.sala_nombre || 'Consultorio: --'} - ${next.hora.substring(0,5)}
                </div>
            `;
            nextPatientContainer.classList.add('next-patient-highlight');
        } else if (nextPatientContainer) {
             nextPatientContainer.innerHTML = `
                <h3 style="color: var(--secondary-color); font-size: 1.25rem; margin-bottom: 1rem;">Próximo Paciente</h3>
                <div style="font-size: 3rem; font-weight: 800; color: #0f172a; margin-bottom: 0.5rem;">
                    --
                </div>
                <div style="font-size: 1.1rem; color: var(--primary-color); font-weight: 500;">
                    Consultorio: --
                </div>
            `;
            nextPatientContainer.classList.remove('next-patient-highlight');
        }

        loadDashboardBilling();
    }

    async function loadDashboardBilling() {
        try {
            const res = await fetchApi('/billing/dashboard');
            if (res && res.status === 'success' && res.data) {
                dashboardRevenueData = res.data;
            } else if (window.isGuestMode) {
                dashboardRevenueData = { 'diaria': '50.00 €', 'semanal': '130.00 €', 'mensual': '540.00 €', 'anual': '12400.00 €' };
            }
            updateRevenueDisplay();
        } catch (error) {
            console.error('Error loading dashboard billing:', error);
        }
    }

    function updateRevenueDisplay() {
        const activeTab = document.querySelector('.period-tabs .tab-btn.active');
        const period = activeTab ? activeTab.getAttribute('data-period') : 'diaria';
        const amountEl = document.getElementById('revenueAmount');
        if (amountEl) {
            amountEl.innerText = dashboardRevenueData[period] || '0.00 €';
        }
    }

    // --- Rendering Functions ---
    function renderPatients(patients) {
        const role = (currentUser && (currentUser.rol || currentUser.role || '')).toLowerCase();
        const container = document.querySelector('.patients-container');
        if (!container) return;

        if (patients.length === 0) {
            container.innerHTML = `<div class="empty-state">No hay pacientes que coincidan.</div>`;
            return;
        }

        let html = '<div class="patient-list" style="width: 100%;">';
        patients.forEach(p => {
            html += `
                <div class="patient-card glass" style="padding: 1rem; margin-bottom: 0.5rem; display: flex; justify-content: space-between; align-items: center; border-radius: 8px;">
                    <div style="display: flex; gap: 1rem; align-items: center; width: 100%;">
                        <div style="flex-grow: 1;">
                            <strong>${p.nombre} ${p.apellidos}</strong><br>
                            <small style="color: var(--secondary-color);">${p.dni} | ${p.telefono}</small>
                        </div>
                        <div class="patient-actions" style="display: flex; gap: 0.5rem;">
                            <button class="btn-secondary" onclick="openPatientDetailById(${p.id})" style="padding: 0.4rem 0.8rem; font-size: 0.8rem;">Ver Ficha</button>
                            ${(role === 'admin' || role === 'super-admin' || role === 'recepcionista' || role === 'doctor') ? `
                                <button class="btn-icon" onclick="openPatientEditById(${p.id})" style="color: var(--primary-color); background: #eff6ff;"><i class="fa-solid fa-pencil"></i></button>
                            ` : ''}
                            ${(role === 'admin' || role === 'super-admin') ? `
                                <button class="btn-icon" onclick="deletePatient(${p.id})" style="color: #ef4444; background: #fef2f2;"><i class="fa-solid fa-trash"></i></button>
                            ` : ''}
                        </div>
                    </div>
                </div>
            `;
        });
        html += '</div>';
        container.innerHTML = html;
    }

    function renderTreatments(treatments) {
        const role = (currentUser && (currentUser.rol || currentUser.role || '')).toLowerCase();
        const container = document.getElementById('treatments-list');
        if (!container) return;

        if (treatments.length === 0) {
            container.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--secondary-color); padding: 3rem;">No hay tratamientos registrados.</td></tr>';
            return;
        }

        container.innerHTML = treatments.map(t => `
            <tr>
                <td>
                    <div style="font-weight: 700; color: #0f172a;">${t.nombre}</div>
                </td>
                <td style="max-width: 300px;">
                    <div style="font-size: 0.9rem; color: var(--secondary-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${t.descripcion || ''}">
                        ${t.descripcion || '--'}
                    </div>
                </td>
                <td>
                    <div style="display: flex; align-items: center; gap: 0.5rem; color: var(--primary-color); font-weight: 600;">
                        <i class="fa-solid fa-clock-rotate-left"></i>
                        <span>${t.duracion_estimada} min</span>
                    </div>
                </td>
                <td>
                    <div class="treatment-price" style="display: inline-block;">${t.precio}€</div>
                </td>
                <td>
                    <div style="display: flex; gap: 0.5rem;">
                        ${(role === 'admin' || role === 'super-admin') ? `
                            <button class="btn-icon" onclick="openTreatmentEditById(${t.id})" title="Editar" style="color: var(--primary-color); background: #eff6ff;"><i class="fa-solid fa-pencil"></i></button>
                            <button class="btn-icon" onclick="deleteTreatment(${t.id})" title="Eliminar" style="color: #ef4444; background: #fef2f2;"><i class="fa-solid fa-trash"></i></button>
                        ` : ''}
                    </div>
                </td>
            </tr>
        `).join('');
    }

    function renderAppointments() {
        const container = document.getElementById('appointments-list');
        if (!container) return;

        const toISODate = (d) => d.toISOString().split('T')[0];
        
        const hasDateFilter = appointmentFilters.fecha_desde || appointmentFilters.fecha_hasta;
        let filteredAppts = [];

        if (hasDateFilter) {
            filteredAppts = [...allAppointments];
        } else {
            const startOfWeek = new Date(currentDate);
            const currentDay = startOfWeek.getDay() || 7;
            startOfWeek.setDate(startOfWeek.getDate() - (currentDay - 1));
            startOfWeek.setHours(0, 0, 0, 0);

            const endOfWeek = new Date(startOfWeek);
            endOfWeek.setDate(startOfWeek.getDate() + 6);
            endOfWeek.setHours(23, 59, 59, 999);

            const startStr = toISODate(startOfWeek);
            const endStr = toISODate(endOfWeek);
            filteredAppts = allAppointments.filter(a => a.fecha >= startStr && a.fecha <= endStr);
        }

        let weekAppts = filteredAppts;

        // --- Role-Based Filtering (Limited View for Patients) ---
        const role = (currentUser && (currentUser.rol || currentUser.role || '')).toLowerCase();
        if (role === 'paciente') {
            if (currentUser.id_paciente) {
                weekAppts = weekAppts.filter(a => a.id_paciente == currentUser.id_paciente);
            } else {
                const patientName = (currentUser.nombre_completo || '').toLowerCase();
                weekAppts = weekAppts.filter(a => `${a.paciente_nombre} ${a.paciente_apellidos}`.toLowerCase() === patientName);
            }
        }

        // Apply filters
        if (appointmentFilters.id_profesional) {
            weekAppts = weekAppts.filter(a => a.id_profesional == appointmentFilters.id_profesional);
        }
        if (appointmentFilters.id_sala) {
            weekAppts = weekAppts.filter(a => a.id_sala == appointmentFilters.id_sala);
        }
        if (appointmentFilters.id_tratamiento) {
            weekAppts = weekAppts.filter(a => a.id_tratamiento == appointmentFilters.id_tratamiento);
        }
        if (appointmentFilters.paciente) {
            const searchTerm = appointmentFilters.paciente.toLowerCase();
            weekAppts = weekAppts.filter(a => {
                const fullName = `${a.paciente_nombre} ${a.paciente_apellidos}`.toLowerCase();
                return fullName.includes(searchTerm);
            });
        }
        if (appointmentFilters.fecha_desde) {
            weekAppts = weekAppts.filter(a => a.fecha >= appointmentFilters.fecha_desde);
        }
        if (appointmentFilters.fecha_hasta) {
            weekAppts = weekAppts.filter(a => a.fecha <= appointmentFilters.fecha_hasta);
        }

        if (weekAppts.length === 0) {
            container.innerHTML = `
                <div class="empty-state glass" style="padding: 3rem; text-align: center; border-radius: 20px;">
                    <i class="fa-solid fa-calendar-circle-exclamation" style="font-size: 3rem; color: var(--primary-color); opacity: 0.2; margin-bottom: 1rem;"></i>
                    <p style="color: var(--secondary-color); font-weight: 500;">No hay citas que coincidan con los filtros aplicados.</p>
                </div>
            `;
            return;
        }

        const groups = {};
        const days = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
        weekAppts.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.hora.localeCompare(b.hora));
        weekAppts.forEach(a => {
            if (!groups[a.fecha]) groups[a.fecha] = [];
            groups[a.fecha].push(a);
        });

        const roomColors = {
            'Sala 1': '#3b82f6',
            'Sala 2': '#10b981',
            'Sala 3': '#f59e0b',
            'Consultorio 1': '#8b5cf6',
            'Consultorio 2': '#ec4899'
        };

        let html = '';

        if (currentCalendarView === 'agenda') {
            const startOfWeek = new Date(currentDate);
            const currentDay = startOfWeek.getDay() || 7;
            startOfWeek.setDate(startOfWeek.getDate() - (currentDay - 1));
            startOfWeek.setHours(0, 0, 0, 0);

            let minHour = 8;
            let maxHour = 20;
            
            // Generate parsed dates and check hours
            weekAppts.forEach(a => {
                const [h, m] = a.hora.split(':').map(Number);
                a.startMin = h * 60 + m;
                a.endMin = a.startMin + parseInt(a.duracion || 30);
                minHour = Math.min(minHour, h);
                maxHour = Math.max(maxHour, Math.ceil(a.endMin / 60));
            });
            maxHour = Math.max(maxHour, minHour + 1);

            const daysArr = [];
            for(let i = 0; i < 7; i++) {
                const d = new Date(startOfWeek);
                d.setDate(d.getDate() + i);
                daysArr.push(d);
            }

            html += `<div class="weekly-calendar-wrapper" style="flex-direction: column;">`;
            html += `<div style="min-width: 800px; display: flex; flex-direction: column; flex: 1; position: relative;">`;
            
            // Header Row
            html += `<div style="display: flex; position: sticky; top: 0; z-index: 10; background: white; border-bottom: 1px solid var(--border-color);">`;
            html += `<div style="width: 60px; flex-shrink: 0; border-right: 1px solid var(--border-color);"></div>`;
            
            html += `<div class="weekly-days-header" style="flex: 1; border-bottom: none; position: static;">`;
            const shortDays = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
            daysArr.forEach((d, i) => {
                const isToday = new Date().toDateString() === d.toDateString();
                const color = isToday ? 'var(--primary-color)' : 'inherit';
                html += `
                    <div class="weekly-day-header">
                        <div class="weekly-day-name" style="color: ${isToday ? 'var(--primary-color)' : 'var(--secondary-color)'}">${shortDays[i]}</div>
                        <div class="weekly-day-number" style="color: ${color}">${d.getDate()}</div>
                    </div>`;
            });
            html += `</div></div>`; // end weekly-days-header & Header Row

            // Body Row
            html += `<div style="display: flex; flex: 1;">`;
            
            // Time Axis
            html += `<div class="weekly-time-axis" style="position: static;">`;
            for(let h = minHour; h <= maxHour; h++) {
                html += `<div class="time-slot-label">${String(h).padStart(2, '0')}:00</div>`;
            }
            html += `</div>`;

            // Grid Body
            html += `<div class="weekly-days-grid" style="flex: 1;">`;
            
            daysArr.forEach(d => {
                html += `<div class="weekly-day-column">`;
                
                // Current time indicator
                const now = new Date();
                if (now.toDateString() === d.toDateString()) {
                    const nowH = now.getHours();
                    const nowM = now.getMinutes();
                    if (nowH >= minHour && nowH <= maxHour) {
                        const topPx = ((nowH - minHour) * 60) + nowM;
                        html += `<div class="current-time-indicator" style="top: ${topPx}px;"></div>`;
                    }
                }

                // Filter appts for this day
                // Use strict ISO date formatting avoiding timezone shifts
                const dy = d.getFullYear();
                const dm = String(d.getMonth() + 1).padStart(2, '0');
                const dd = String(d.getDate()).padStart(2, '0');
                const dayStr = `${dy}-${dm}-${dd}`;
                let dayAppts = weekAppts.filter(a => a.fecha === dayStr);
                
                // Overlap calculation
                dayAppts.sort((a,b) => a.startMin - b.startMin);
                let columns = [];
                dayAppts.forEach(a => {
                    let placed = false;
                    for(let c = 0; c < columns.length; c++) {
                        if (columns[c] <= a.startMin) {
                            columns[c] = a.endMin;
                            a.col = c;
                            placed = true;
                            break;
                        }
                    }
                    if (!placed) {
                        a.col = columns.length;
                        columns.push(a.endMin);
                    }
                });

                const totalCols = columns.length > 0 ? columns.length : 1;
                
                dayAppts.forEach(a => {
                    const topPx = a.startMin - (minHour * 60);
                    const heightPx = Math.max(15, a.endMin - a.startMin); // min height 15px
                    const widthPct = 100 / totalCols;
                    const leftPct = a.col * widthPct;
                    const roomColor = roomColors[a.sala_nombre] || 'var(--primary-color)';
                    const onClickAttr = currentUser ? `onclick="openAppointmentEditById(${a.id})"` : '';
                    
                    html += `
                        <div class="weekly-appointment-block"
                             style="top: ${topPx}px; height: ${heightPx}px; left: ${leftPct}%; width: ${widthPct}%; background-color: ${roomColor};"
                             ${onClickAttr} title="${a.paciente_nombre} - ${a.tratamiento_nombre}">
                            <div style="font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; line-height: 1;">
                                ${a.hora.substring(0,5)} - ${a.paciente_nombre}
                            </div>
                            <div style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; opacity: 0.9; margin-top: 2px;">
                                ${a.tratamiento_nombre}
                            </div>
                        </div>`;
                });
                
                html += `</div>`; // .weekly-day-column
            });

            html += `</div>`; // .weekly-days-grid
            html += `</div>`; // .weekly-body-row (inner min-width wrapper body)
            html += `</div>`; // .inner min-width wrapper
            html += `</div>`; // .weekly-calendar-wrapper
        } else {
            Object.keys(groups).sort().forEach(dateStr => {
                const [y, m, d] = dateStr.split('-').map(Number);
                const date = new Date(y, m - 1, d);
                const dayName = days[(date.getDay() || 7) - 1];
                const formattedDate = date.toLocaleDateString('es-ES', { day: 'numeric', month: 'long' });

                html += `
                    <div class="day-group" style="margin-bottom: 2.5rem;">
                        <h3 style="color: #0f172a; margin-bottom: 1.25rem; padding-left: 0.75rem; border-left: 5px solid var(--primary-color); font-weight: 700; font-size: 1.25rem;">
                            ${dayName}, ${formattedDate}
                        </h3>
                        <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 1.5rem;">
                            ${groups[dateStr].map(a => {
                    const roomColor = roomColors[a.sala_nombre] || '#64748b';
                    return `
                                    <div class="premium-card appointment-card" style="border-left-color: ${roomColor};">
                                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
                                            <div class="appt-time">
                                                <i class="fa-regular fa-clock" style="font-size: 0.9em; opacity: 0.7;"></i>
                                                ${a.hora.substring(0, 5)}
                                            </div>
                                            <div style="font-size: 0.75rem; background: #f1f5f9; color: #475569; padding: 0.25rem 0.6rem; border-radius: 20px; font-weight: 700;">
                                                ${a.duracion} MIN
                                            </div>
                                        </div>
                                        <div class="appt-patient">${a.paciente_nombre} ${a.paciente_apellidos}</div>
                                        <div class="appt-details">
                                            <div class="appt-detail-item">
                                                <i class="fa-solid fa-stethoscope"></i>
                                                <span>${a.tratamiento_nombre}</span>
                                            </div>
                                            <div class="appt-detail-item">
                                                <i class="fa-solid fa-user-doctor"></i>
                                                <span>${a.profesional_nombre}</span>
                                            </div>
                                            <div class="appt-detail-item">
                                                <i class="fa-solid fa-door-open" style="color: ${roomColor};"></i>
                                                <span style="font-weight: 600; color: #0f172a;">${a.sala_nombre}</span>
                                            </div>
                                        </div>
                                        <div class="appt-actions">
                                            <span class="status-badge status-${a.id_estado || a.estado} ${a.estado === 'en_espera' ? 'status-en-espera' : ''}" ${a.estado === 'en_espera' ? 'style="background-color: #f0fdfa; color: #0f766e; border: 1px solid #14b8a6;"' : ''}>
                                                <i class="fa-solid fa-circle" style="font-size: 0.5rem;"></i>
                                                ${a.estado.replace('_', ' ')}
                                            </span>
                                            <div style="margin-left: auto; display: flex; gap: 0.4rem;">
                                                ${currentUser && (!a.estado || ['pendiente', 'nuevo', 'programada'].includes(a.estado.toLowerCase())) ? `<button class="btn-icon" onclick="confirmAppointment(${a.id})" title="Confirmar" style="width: 32px; height: 32px; color: #10b981; background: #ecfdf5;"><i class="fa-solid fa-check"></i></button>` : ''}
                                                ${currentUser && (a.estado && a.estado.toLowerCase() !== 'cancelada') ? `<button class="btn-icon" onclick="cancelAppointment(${a.id})" title="Cancelar" style="width: 32px; height: 32px; color: #f59e0b; background: #fffbeb;"><i class="fa-solid fa-ban"></i></button>` : ''}
                                                ${currentUser ? `<button class="btn-icon" onclick="openAppointmentEditById(${a.id})" title="Editar" style="width: 32px; height: 32px; color: var(--primary-color); background: #eff6ff;"><i class="fa-solid fa-pencil"></i></button>` : ''}
                                                ${currentUser ? `<button class="btn-icon" onclick="deleteAppointment(${a.id})" title="Eliminar" style="width: 32px; height: 32px; color: #ef4444; background: #fef2f2;"><i class="fa-solid fa-trash"></i></button>` : ''}
                                            </div>
                                        </div>
                                    </div>
                                `;
                }).join('')}
                        </div>
                    </div>
                `;
            });
        }

        container.innerHTML = html;
    }

    function renderInventory(items) {
        const role = (currentUser && (currentUser.rol || currentUser.role || '')).toLowerCase();
        const container = document.getElementById('inventory-list');
        if (!container) return;

        if (items.length === 0) {
            container.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--secondary-color); padding: 3rem;">No hay productos en el inventario.</td></tr>';
            return;
        }

        container.innerHTML = items.map(item => {
            let statusClass = 'status-instock';
            let statusText = 'En Stock';
            if (item.cantidad <= 0) {
                statusClass = 'status-out';
                statusText = 'Sin Stock';
            } else if (item.cantidad <= (item.nivel_de_reposicion || 5)) {
                statusClass = 'status-low';
                statusText = 'Bajo Stock';
            }

            return `
                <tr>
                    <td>
                        <div style="font-weight: 600; color: #0f172a;">${item.nombre_producto}</div>
                        <div style="font-size: 0.8rem; color: var(--secondary-color);">${item.marca || '--'}</div>
                    </td>
                    <td><span class="category-tag">${item.categoria}</span></td>
                    <td>
                        <div style="font-weight: 700;">${item.cantidad}</div>
                        <div style="font-size: 0.75rem; color: var(--secondary-color);">${item.unidades}</div>
                    </td>
                    <td><span class="stock-badge ${statusClass}">${statusText}</span></td>
                    <td>
                        <div style="font-size: 0.9rem;">${item.fecha_de_compra || '--'}</div>
                        <div style="font-size: 0.75rem; color: var(--secondary-color);">Lote: ${item.lote || '--'}</div>
                    </td>
                    <td>
                        <div style="display: flex; gap: 0.5rem;">
                            ${(role === 'admin' || role === 'super-admin' || role === 'asistente') ? `
                                <button class="btn-icon adjust-stock-btn" onclick="adjustStock(${item.id}, 'add')" title="Añadir stock" style="color: #10b981; background: #ecfdf5;"><i class="fa-solid fa-plus"></i></button>
                                <button class="btn-icon adjust-stock-btn" onclick="adjustStock(${item.id}, 'remove')" title="Quitar stock" style="color: #f59e0b; background: #fffbeb;"><i class="fa-solid fa-minus"></i></button>
                            ` : ''}
                            ${(role === 'admin' || role === 'super-admin') ? `
                                <button class="btn-icon edit-inventory-btn" onclick="openInventoryEditById(${item.id})" style="color: var(--primary-color); background: #eff6ff;"><i class="fa-solid fa-pencil"></i></button>
                                <button class="btn-icon delete-inventory-btn" onclick="deleteInventory(${item.id})" style="color: #ef4444; background: #fef2f2;"><i class="fa-solid fa-trash"></i></button>
                            ` : ''}
                        </div>
                    </td>
                </tr>
            `;
        }).join('');

    }

    function renderRooms(rooms) {
        const container = document.getElementById('rooms-list-container');
        if (!container) return;

        if (rooms.length === 0) {
            container.innerHTML = '<p style="color: var(--secondary-color);">No hay salas configuradas.</p>';
            return;
        }

        container.innerHTML = rooms.map(r => `
            <div class="room-card glass" style="border-left: 5px solid ${r.color_asociado || '#3b82f6'}; padding: 1rem; border-radius: 12px; display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem;">
                <div>
                    <h4 style="margin: 0;">${r.nombre}</h4>
                    <p style="margin: 0; font-size: 0.85rem; color: var(--secondary-color);">${r.descripcion || 'Sin descripción'}</p>
                </div>
                <div style="display: flex; gap: 0.5rem;">
                    <button class="btn-icon" onclick="openRoomEditById(${r.id})" style="color: var(--primary-color);"><i class="fa-solid fa-pencil"></i></button>
                    <button class="btn-icon" onclick="deleteRoom(${r.id})" style="color: #ef4444;"><i class="fa-solid fa-trash"></i></button>
                </div>
            </div>
        `).join('');
    }

    function renderTeam(team) {
        const container = document.getElementById('team-list-container');
        if (!container) return;

        if (team.length === 0) {
            container.innerHTML = '<p style="color: var(--secondary-color);">No hay profesionales registrados.</p>';
            return;
        }

        container.innerHTML = team.map(m => `
            <div class="team-member-card glass" style="padding: 1rem; border-radius: 12px; display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem;">
                <div style="display: flex; align-items: center; gap: 1rem;">
                    <div style="width: 40px; height: 40px; border-radius: 50%; background: #eff6ff; color: var(--primary-color); display: flex; align-items: center; justify-content: center; font-weight: 700;">
                        ${m.nombre.split(' ').map(n => n[0]).join('')}
                    </div>
                    <div>
                        <h4 style="margin: 0;">${m.nombre}</h4>
                        <p style="margin: 0; font-size: 0.85rem; color: var(--secondary-color);"><span style="text-transform: capitalize; font-weight: 600; color: var(--primary-color);">${m.rol}</span> | ${m.especialidad} | ${m.email || '--'}</p>
                    </div>
                </div>
                <div style="display: flex; gap: 0.5rem;">
                    <button class="btn-icon" onclick="openProfessionalEditById(${m.id})" style="color: var(--primary-color);"><i class="fa-solid fa-pencil"></i></button>
                    <button class="btn-icon" onclick="deleteProfessional(${m.id})" style="color: #ef4444;"><i class="fa-solid fa-trash"></i></button>
                </div>
            </div>
        `).join('');
    }

    function renderConsentDocuments(docs) {
        const container = document.getElementById('consent-list');
        if (!container) return;

        if (docs.length === 0) {
            container.innerHTML = '<p style="text-align: center; color: var(--secondary-color);">No hay formularios subidos.</p>';
            return;
        }

        container.innerHTML = docs.map(doc => `
            <div class="document-item glass" style="padding: 1.25rem; border-radius: 12px; display: flex; justify-content: space-between; align-items: center; border: 1px solid rgba(255,255,255,0.5);">
                <div style="display: flex; gap: 1rem; align-items: center;">
                    <div style="width: 45px; height: 45px; border-radius: 10px; background: #fee2e2; color: #ef4444; display: flex; align-items: center; justify-content: center; font-size: 1.25rem;">
                        <i class="fa-solid fa-file-pdf"></i>
                    </div>
                    <div>
                        <h4 style="margin: 0; color: #0f172a;">${doc.titulo}</h4>
                        <p style="margin: 0.25rem 0 0; font-size: 0.85rem; color: var(--secondary-color);">${doc.descripcion || 'Sin descripción'}</p>
                        <p style="margin: 0.25rem 0 0; font-size: 0.75rem; color: #94a3b8;"><i class="fa-solid fa-calendar-alt"></i> ${new Date(doc.fecha_subida).toLocaleDateString('es-ES')}</p>
                    </div>
                </div>
                <div style="display: flex; gap: 0.5rem;">
                    <a href="/uploads/consent/${doc.archivo_path}" target="_blank" class="btn-icon" style="color: var(--primary-color); background: #eff6ff; text-decoration: none;">
                        <i class="fa-solid fa-eye"></i>
                    </a>
                    <button class="btn-icon" onclick="deleteConsentDocument(${doc.id})" style="color: #ef4444; background: #fef2f2;">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </div>
            </div>
        `).join('');
    }

    window.deleteConsentDocument = async (id) => {
        if (confirm('¿Eliminar este documento permanentemente?')) {
            const res = await fetchApi(`/consent/${id}`, 'DELETE');
            if (res && res.status === 'success') loadConsentDocuments();
        }
    };

    function renderUsers(users) {
        const container = document.getElementById('user-list');
        if (!container) return;

        if (users.length === 0) {
            container.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--secondary-color); padding: 3rem;">No hay usuarios registrados.</td></tr>';
            return;
        }

        container.innerHTML = users.map(user => `
            <tr>
                <td>
                    <div style="font-weight: 600; color: #0f172a;">${user.nombre_completo}</div>
                </td>
                <td>${user.username}</td>
                <td><span class="category-tag">${user.rol}</span></td>
                <td>${user.fecha_creacion ? new Date(user.fecha_creacion).toLocaleDateString('es-ES') : '--'}</td>
                <td>
                    <div style="display: flex; gap: 0.5rem;">
                        <button class="btn-icon" onclick="openUserEditById(${user.id})" style="color: var(--primary-color); background: #eff6ff;"><i class="fa-solid fa-pencil"></i></button>
                        <button class="btn-icon" onclick="deleteUser(${user.id})" style="color: #ef4444; background: #fef2f2;"><i class="fa-solid fa-trash"></i></button>
                    </div>
                </td>
            </tr>
        `).join('');
    }

    // --- Global Callbacks for UI Actions ---
    window.openPatientDetailById = (id) => {
        const patient = allPatients.find(p => p.id == id);
        if (patient) openPatientDetail(patient);
    };

    window.openPatientEditById = (id) => {
        const patient = allPatients.find(p => p.id == id);
        if (patient) openPatientEdit(patient);
    };

    window.openTreatmentEditById = (id) => {
        const t = allTreatments.find(item => item.id == id);
        if (t) openTreatmentEdit(t);
    };

    window.openRoomEditById = (id) => {
        fetchApi('/rooms').then(rooms => {
            const r = (rooms || []).find(item => item.id == id);
            if (r) openRoomEdit(r);
        });
    };

    window.openProfessionalEditById = (id) => {
        fetchApi('/professionals').then(team => {
            const m = (team || []).find(item => item.id == id);
            if (m) openProfessionalEdit(m);
        });
    };

    window.openUserEditById = (id) => {
        const user = allUsers.find(u => u.id == id);
        if (user) openUserEdit(user);
    };

    // --- Search Logic ---
    // Consolidate Search Logic
    function setupSearchListeners() {
        const patientSearch = document.getElementById('patientSearch');
        if (patientSearch) {
            patientSearch.addEventListener('input', (e) => {
                const query = e.target.value.toLowerCase();
                const filtered = allPatients.filter(p =>
                    p.nombre.toLowerCase().includes(query) ||
                    p.apellidos.toLowerCase().includes(query) ||
                    p.dni.toLowerCase().includes(query) ||
                    (p.email && p.email.toLowerCase().includes(query)) ||
                    (p.telefono && p.telefono.includes(query))
                );
                renderPatients(filtered);
            });
        }

        const treatmentSearch = document.getElementById('treatmentSearch');
        if (treatmentSearch) {
            treatmentSearch.addEventListener('input', (e) => {
                const query = e.target.value.toLowerCase();
                const filtered = allTreatments.filter(t =>
                    t.nombre.toLowerCase().includes(query) ||
                    (t.descripcion && t.descripcion.toLowerCase().includes(query))
                );
                renderTreatments(filtered);
            });
        }

        const inventorySearch = document.getElementById('inventorySearch');
        if (inventorySearch) {
            inventorySearch.addEventListener('input', (e) => {
                const query = e.target.value.toLowerCase();
                const filtered = allInventory.filter(item =>
                    item.nombre_producto.toLowerCase().includes(query) ||
                    (item.marca && item.marca.toLowerCase().includes(query)) ||
                    item.categoria.toLowerCase().includes(query)
                );
                renderInventory(filtered);
            });
        }

        const billingSearchUnbilled = document.getElementById('billingSearchUnbilled');
        if (billingSearchUnbilled) {
            billingSearchUnbilled.addEventListener('input', (e) => {
                const query = e.target.value.toLowerCase();
                const filtered = allUnbilledAppointments.filter(item =>
                    item.paciente_nombre_completo.toLowerCase().includes(query) ||
                    item.tratamiento_nombre.toLowerCase().includes(query)
                );
                renderUnbilledAppointments(filtered);
            });
        }

        const billingSearchInvoices = document.getElementById('billingSearchInvoices');
        if (billingSearchInvoices) {
            billingSearchInvoices.addEventListener('input', (e) => {
                const query = e.target.value.toLowerCase();
                const filtered = allInvoices.filter(item =>
                    item.numero_factura.toLowerCase().includes(query) ||
                    item.paciente_nombre_completo.toLowerCase().includes(query) ||
                    item.metodo_pago.toLowerCase().includes(query)
                );
                renderInvoices(filtered);
            });
        }
    }


    const apptPatientSearch = document.getElementById('apptPatientSearch');
    const apptPatientResults = document.getElementById('apptPatientResults');
    const selectedPatientId = document.getElementById('selectedPatientId');

    if (apptPatientSearch && apptPatientResults) {
        apptPatientSearch.addEventListener('input', (e) => {
            const query = e.target.value.toLowerCase();
            if (query.length < 2 || query === lastSelectedPatientName.toLowerCase()) {
                apptPatientResults.classList.add('hidden');
                return;
            }
            const filtered = allPatients.filter(p =>
                p.nombre.toLowerCase().includes(query) ||
                p.apellidos.toLowerCase().includes(query) ||
                p.dni.toLowerCase().includes(query)
            );
            if (filtered.length > 0) {
                apptPatientResults.innerHTML = filtered.map(p => `
                        <div class="search-result-item" data-id="${p.id}" data-name="${p.nombre} ${p.apellidos}" style="padding: 0.75rem 1rem; cursor: pointer; border-bottom: 1px solid #f1f5f9;">
                            <div style="font-weight: 600; color: #0f172a;">${p.nombre} ${p.apellidos}</div>
                            <div style="font-size: 0.8rem; color: var(--secondary-color);">${p.dni}</div>
                        </div>
                    `).join('');
                apptPatientResults.classList.remove('hidden');
                apptPatientResults.querySelectorAll('.search-result-item').forEach(item => {
                    item.addEventListener('click', () => {
                        const selectedName = item.getAttribute('data-name');
                        apptPatientSearch.value = selectedName;
                        lastSelectedPatientName = selectedName;
                        selectedPatientId.value = item.getAttribute('data-id');
                        apptPatientResults.classList.add('hidden');
                        apptPatientResults.innerHTML = '';
                    });
                });
            } else {
                apptPatientResults.innerHTML = '<div style="padding: 1rem; color: var(--secondary-color);">No se encontraron pacientes</div>';
                apptPatientResults.classList.remove('hidden');
            }
        });
        document.addEventListener('click', (e) => {
            if (!apptPatientSearch.contains(e.target) && !apptPatientResults.contains(e.target)) {
                apptPatientResults.classList.add('hidden');
            }
        });
    }

    const userSearch = document.getElementById('userSearch');
    if (userSearch) {
        userSearch.addEventListener('input', (e) => {
            const query = e.target.value.toLowerCase();
            const filtered = allUsers.filter(u =>
                u.nombre_completo.toLowerCase().includes(query) ||
                u.username.toLowerCase().includes(query) ||
                u.rol.toLowerCase().includes(query)
            );
            renderUsers(filtered);
        });
    }


    // --- Navigation Logic ---
    const navItems = document.querySelectorAll('.nav-item');
    const sections = document.querySelectorAll('.section-content');
    const pageTitle = document.getElementById('pageTitle');

    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const targetId = item.getAttribute('data-target');

            // --- Permission Check ---
            if (currentUser && targetId && !hasPermission(targetId)) {
                alert('No tienes permiso para acceder a esta sección.');
                return;
            }

            navItems.forEach(nav => nav.classList.remove('active'));
            item.classList.add('active');
            sections.forEach(section => {
                section.classList.remove('active');
                if (section.id === `${targetId}-view`) section.classList.add('active');
            });
            pageTitle.innerText = item.querySelector('span').innerText;

            if (targetId === 'pacientes') loadPatients();
            if (targetId === 'tratamientos') loadTreatments();
            if (targetId === 'calendario') loadAppointments();
            if (targetId === 'inventario') loadInventory();
            if (targetId === 'consentimiento') loadConsentDocuments();
            if (targetId === 'usuarios') loadUsers();
            if (targetId === 'facturacion') loadBillingData();
            if (targetId === 'dashboard') loadDashboardBilling();
        });
    });

    const configTabs = document.querySelectorAll('.config-tab-btn');
    const configSections = document.querySelectorAll('.config-section');
    configTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            configTabs.forEach(t => t.classList.remove('active'));
            configSections.forEach(s => s.classList.remove('active'));
            tab.classList.add('active');
            const targetId = tab.getAttribute('data-config-target');
            document.getElementById(targetId).classList.add('active');
            if (targetId === 'salas-config') loadRooms();
            if (targetId === 'equipo-config') loadTeam();
            if (targetId === 'clinica-config') loadClinicInfo();
            if (targetId === 'horarios-config') loadSchedule();
            if (targetId === 'marketing-config') loadMarketingCampaigns();
            if (targetId === 'integracion-config') loadIntegrations();
            if (targetId === 'promo-config') loadPromotions();
        });
    });

    // --- Billing Sub-tabs ---
    const billingTabs = document.querySelectorAll('.billing-tab-btn');
    const billingSubSections = document.querySelectorAll('.billing-panel');
    billingTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            billingTabs.forEach(t => t.classList.remove('active'));
            billingSubSections.forEach(s => s.classList.remove('active'));
            tab.classList.add('active');
            const targetId = tab.getAttribute('data-billing-target');
            const section = document.getElementById(targetId);
            if (section) section.classList.add('active');
            
            if (targetId === 'citas-completadas') loadUnbilledAppointments();
            if (targetId === 'lista-facturas') loadInvoices();
            if (targetId === 'lista-presupuestos') window.loadPresupuestos();
        });
    });

    // --- Dashboard Revenue Logic ---
    const revenueTabs = document.querySelectorAll('.tab-btn');
    const revenueAmount = document.getElementById('revenueAmount');

    revenueTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            revenueTabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            updateRevenueDisplay();
            if (revenueAmount) {
                revenueAmount.style.opacity = '0';
                setTimeout(() => revenueAmount.style.opacity = '1', 200);
            }
        });
    });

    // --- Week Navigation Logic ---
    const weekDisplay = document.getElementById('currentWeekDisplay');
    function updateWeekDisplay() {
        const startOfWeek = new Date(currentDate);
        const currentDay = startOfWeek.getDay() || 7;
        startOfWeek.setDate(startOfWeek.getDate() - (currentDay - 1));
        const endOfWeek = new Date(startOfWeek);
        endOfWeek.setDate(startOfWeek.getDate() + 6);
        const options = { day: 'numeric', month: 'long' };
        if (weekDisplay) weekDisplay.textContent = `${startOfWeek.toLocaleDateString('es-ES', options)} - ${endOfWeek.toLocaleDateString('es-ES', options)}`;
    }

    if (document.getElementById('prevWeekBtn')) document.getElementById('prevWeekBtn').addEventListener('click', () => { currentDate.setDate(currentDate.getDate() - 7); updateWeekDisplay(); renderAppointments(); });
    if (document.getElementById('nextWeekBtn')) document.getElementById('nextWeekBtn').addEventListener('click', () => { currentDate.setDate(currentDate.getDate() + 7); updateWeekDisplay(); renderAppointments(); });
    if (document.getElementById('todayBtn')) document.getElementById('todayBtn').addEventListener('click', () => { currentDate = new Date(); updateWeekDisplay(); renderAppointments(); });

    // --- Modal Logic ---
    const patientModal = document.getElementById('patientModal');
    const patientForm = document.getElementById('patientForm');
    const patientDetailModal = document.getElementById('patientDetailModal');
    const patientDetailContent = document.getElementById('patientDetailContent');

    const treatmentModal = document.getElementById('treatmentModal');
    const treatmentForm = document.getElementById('treatmentForm');

    const appointmentModal = document.getElementById('appointmentModal');
    const appointmentForm = document.getElementById('appointmentForm');

    const roomModal = document.getElementById('roomModal');
    const roomForm = document.getElementById('roomForm');
    const teamModal = document.getElementById('teamModal');
    const teamForm = document.getElementById('teamForm');

    const inventoryModal = document.getElementById('inventoryModal');
    const inventoryForm = document.getElementById('inventoryForm');

    const uploadFormModal = document.getElementById('uploadFormModal');
    const uploadForm = document.getElementById('uploadForm');

    const stockAdjustmentModal = document.getElementById('stockAdjustmentModal');
    const stockAdjustmentForm = document.getElementById('stockAdjustmentForm');

    const openPatientEdit = (p) => {
        editingPatientId = p.id;
        document.querySelector('#patientModal h2').innerText = 'Editar Paciente';
        const form = document.getElementById('patientForm');
        form.dni.value = p.dni || '';
        form.nombre.value = p.nombre || '';
        form.apellidos.value = p.apellidos || '';
        form.calle.value = p.calle || '';
        form.numero_calle.value = p.numero_calle || '';
        form.escalera.value = p.escalera || '';
        form.piso.value = p.piso || '';
        form.puerta.value = p.puerta || '';
        form.cp.value = p.cp || '';
        form.municipio.value = p.municipio || '';
        form.poblacion_provincia.value = p.poblacion_provincia || '';
        form.pais.value = p.pais || 'España';
        form.fechaNacimiento.value = p.fecha_nacimiento || '';
        form.genero.value = p.genero || '';
        form.email.value = p.email || '';
        form.telefono.value = p.telefono || '';
        form.alergias.value = p.alergias || '';
        form.problemasMedicos.value = p.problemas_medicos || '';
        form.medicamentos.value = p.medicamentos_actuales || '';
        form.cirugias.value = p.cirugias_previas || '';
        form.afeccion.value = p.afeccion || '';
        form.notas.value = p.notas_adicionales || '';
        form.emergenciaNombre.value = p.emergencia_nombre || '';
        form.emergenciaTelefono.value = p.emergencia_telefono || '';
        form.emergenciaRelacion.value = p.emergencia_relacion || '';
        patientModal.classList.remove('hidden');
    };

    const openPatientDetail = (p) => {
        patientDetailContent.innerHTML = `
            <div style="display: flex; flex-direction: column; gap: 2rem;">
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem;">
                    <div>
                        <h4 style="color: var(--primary-color); border-bottom: 2px solid #eff6ff; padding-bottom: 0.5rem;">Datos Personales</h4>
                        <p><strong>DNI:</strong> ${p.dni}</p>
                        <p><strong>Nacimiento:</strong> ${p.fecha_nacimiento}</p>
                        <p><strong>Registro:</strong> ${p.fecha_registro ? new Date(p.fecha_registro).toLocaleDateString('es-ES') : '--'}</p>
                        <p><strong>Género:</strong> ${p.genero}</p>
                        <p><strong>Email:</strong> ${p.email}</p>
                        <p><strong>Dirección:</strong> ${p.calle} ${p.numero_calle || ''}, ${p.piso || ''}${p.puerta || ''}</p>
                    </div>
                    <div>
                        <h4 style="color: var(--primary-color); border-bottom: 2px solid #eff6ff; padding-bottom: 0.5rem;">Emergencia</h4>
                        <p><strong>Nombre:</strong> ${p.emergencia_nombre || '--'}</p>
                        <p><strong>Teléfono:</strong> ${p.emergencia_telefono || '--'}</p>
                    </div>
                </div>
            </div>
        `;
        patientDetailModal.classList.remove('hidden');
    };

    const openTreatmentEdit = (t) => {
        editingTreatmentId = t.id;
        document.querySelector('#treatmentModal h2').innerText = 'Editar Tratamiento';
        treatmentForm.nombre.value = t.nombre || '';
        treatmentForm.descripcion.value = t.descripcion || '';
        treatmentForm.duracion_estimada.value = t.duracion_estimada || '';
        treatmentForm.precio.value = t.precio || '';
        treatmentModal.classList.remove('hidden');
    };

    const openRoomEdit = (r) => {
        editingRoomId = r.id;
        document.querySelector('#roomModal h2').innerText = 'Editar Sala';
        roomForm.nombre.value = r.nombre || '';
        roomForm.descripcion.value = r.descripcion || '';
        roomForm.color_asociado.value = r.color_asociado || '#3b82f6';
        roomModal.classList.remove('hidden');
    };

    const openProfessionalEdit = (m) => {
        editingProfessionalId = m.id;
        document.querySelector('#teamModal h2').innerText = 'Editar Miembro del Equipo';
        if (teamForm.nombre) teamForm.nombre.value = m.nombre || '';
        if (teamForm.especialidad) teamForm.especialidad.value = m.especialidad || '';
        if (teamForm.rol) teamForm.rol.value = m.rol || 'dentista';
        if (teamForm.sueldo) teamForm.sueldo.value = m.sueldo || '';
        if (teamForm.fecha_nacimiento) teamForm.fecha_nacimiento.value = m.fecha_nacimiento || '';
        if (teamForm.telefono) teamForm.telefono.value = m.telefono || '';
        if (teamForm.email) teamForm.email.value = m.email || '';
        if (teamForm.calle) teamForm.calle.value = m.calle || '';
        if (teamForm.numero_calle) teamForm.numero_calle.value = m.numero_calle || '';
        if (teamForm.cp) teamForm.cp.value = m.cp || '';
        if (teamForm.municipio) teamForm.municipio.value = m.municipio || '';
        if (teamForm.poblacion_provincia) teamForm.poblacion_provincia.value = m.poblacion_provincia || '';
        if (teamForm.pais) teamForm.pais.value = m.pais || 'España';
        teamModal.classList.remove('hidden');
    };

    const openInventoryEdit = (item) => {
        editingInventoryId = item.id;
        document.querySelector('#inventoryModal h2').innerText = 'Editar Producto';
        inventoryForm.nombre_producto.value = item.nombre_producto || '';
        inventoryForm.marca.value = item.marca || '';
        inventoryForm.cantidad.value = item.cantidad || 0;
        inventoryForm.unidades.value = item.unidades || 'unidades';
        inventoryForm.categoria.value = item.categoria || 'consumibles';
        inventoryForm.nivel_de_reposicion.value = item.nivel_de_reposicion || '';
        inventoryForm.lote.value = item.lote || '';
        inventoryForm.fecha_de_compra.value = item.fecha_de_compra || '';
        inventoryForm.fecha_de_caducidad.value = item.fecha_de_caducidad || '';
        inventoryForm.coste.value = item.coste || '';
        inventoryForm.precio_de_venta.value = item.precio_de_venta || '';
        inventoryForm.notas_adicionales.value = item.notas_adicionales || '';
        inventoryModal.classList.remove('hidden');
    };

    window.deletePatient = async (id) => {
        if (confirm('¿Eliminar paciente?')) {
            const res = await fetchApi(`/patients/${id}`, 'DELETE');
            if (res && res.status === 'success') loadPatients();
        }
    };

    window.deleteTreatment = async (id) => {
        if (confirm('¿Eliminar tratamiento?')) {
            const res = await fetchApi(`/treatments/${id}`, 'DELETE');
            if (res && res.status === 'success') { loadTreatments(); loadDropdowns(); }
        }
    };

    window.openInventoryEditById = (id) => {
        const item = allInventory.find(i => i.id == id);
        if (item) openInventoryEdit(item);
    };

    window.deleteInventory = async (id) => {
        if (confirm('¿Eliminar este producto permanentemente?')) {
            const res = await fetchApi(`/inventory/${id}`, 'DELETE');
            if (res && res.status === 'success') loadInventory();
        }
    };

    window.adjustStock = (id, type) => {
        const item = allInventory.find(i => i.id == id);
        if (!item) return;

        document.getElementById('stockAdjustmentId').value = id;
        document.getElementById('stockAdjustmentType').value = type;
        document.getElementById('stockAdjustmentQuantity').value = 1;

        const title = type === 'add' ? 'Añadir Stock' : 'Retirar Stock';
        document.getElementById('stockAdjustmentTitle').innerText = title;

        stockAdjustmentModal.classList.remove('hidden');
        document.getElementById('stockAdjustmentQuantity').focus();
    };

    window.deleteRoom = async (id) => {
        if (confirm('¿Eliminar sala?')) {
            const res = await fetchApi(`/rooms/${id}`, 'DELETE');
            if (res && res.status === 'success') { loadRooms(); loadDropdowns(); }
        }
    };

    window.deleteProfessional = async (id) => {
        if (confirm('¿Eliminar miembro del equipo?')) {
            const res = await fetchApi(`/professionals/${id}`, 'DELETE');
            if (res && res.status === 'success') { loadTeam(); loadDropdowns(); }
        }
    };

    window.deleteUser = async (id) => {
        if (confirm('¿Eliminar este usuario permanentemente?')) {
            const res = await fetchApi(`/users/${id}`, 'DELETE');
            if (res && res.status === 'success') loadUsers();
        }
    };

    const openUserEdit = (user) => {
        editingUserId = user.id;
        document.getElementById('userModalTitle').innerText = 'Editar Usuario';
        const form = document.getElementById('userForm');
        form.nombre_completo.value = user.nombre_completo;
        form.username.value = user.username;
        form.rol.value = user.rol;
        form.password.value = '';
        form.password.required = false;
        document.getElementById('passwordHelp').style.display = 'block';
        document.getElementById('userModal').classList.remove('hidden');
    };

    const openAppointmentEdit = (a) => {
        editingAppointmentId = a.id;
        document.getElementById('appointmentModalTitle').innerText = 'Editar Cita';

        // Reset patient search state
        const selectedName = `${a.paciente_nombre} ${a.paciente_apellidos}`;
        document.getElementById('apptPatientSearch').value = selectedName;
        lastSelectedPatientName = selectedName;
        document.getElementById('selectedPatientId').value = a.id_paciente;

        // Fill other fields
        appointmentForm.querySelector('[name="id_tratamiento"]').value = a.id_tratamiento;
        appointmentForm.querySelector('[name="id_profesional"]').value = a.id_profesional;
        appointmentForm.querySelector('[name="id_sala"]').value = a.id_sala;
        appointmentForm.querySelector('[name="fecha"]').value = a.fecha;
        appointmentForm.querySelector('[name="hora"]').value = a.hora;
        appointmentForm.querySelector('[name="duracion"]').value = a.duracion;
        appointmentForm.querySelector('[name="estado"]').value = a.estado;
        
        const cobradoInput = appointmentForm.querySelector('[name="cobrado"]');
        if (cobradoInput) cobradoInput.checked = !!a.cobrado;

        appointmentModal.classList.remove('hidden');
    };

    window.openAppointmentEditById = (id) => {
        const appointment = allAppointments.find(a => a.id == id);
        if (appointment) openAppointmentEdit(appointment);
    };

    window.confirmAppointment = async (id) => {
        if (confirm('¿Confirmar esta cita?')) {
            const res = await fetchApi(`/appointments/${id}/status`, 'PATCH', { estado: 'confirmada' });
            if (res && res.status === 'success') {
                loadAppointments();
                updateDashboardMetrics();
            } else {
                alert('Error al confirmar cita: ' + (res.message || 'Error desconocido'));
            }
        }
    };

    window.cancelAppointment = async (id) => {
        if (confirm('¿Cancelar esta cita?')) {
            const res = await fetchApi(`/appointments/${id}/status`, 'PATCH', { estado: 'cancelada' });
            if (res && res.status === 'success') {
                loadAppointments();
                updateDashboardMetrics();
            } else {
                alert('Error al cancelar cita: ' + (res.message || 'Error desconocido'));
            }
        }
    };

    window.deleteAppointment = async (id) => {
        if (confirm('¿Eliminar esta cita permanentemente?')) {
            const res = await fetchApi(`/appointments/${id}`, 'DELETE');
            if (res && res.status === 'success') {
                loadAppointments();
                updateDashboardMetrics();
            } else {
                alert('Error al eliminar cita');
            }
        }
    };

    // --- Form Submissions ---
    if (patientForm) patientForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const data = Object.fromEntries(new FormData(patientForm).entries());
        const res = await fetchApi(editingPatientId ? `/patients/${editingPatientId}` : '/patients', editingPatientId ? 'PUT' : 'POST', data);
        if (res && res.status === 'success') {
            patientModal.classList.add('hidden');
            loadPatients();
        } else if (res && res.status === 'error') {
            alert('Error al guardar paciente: ' + res.message);
        }
    });

    if (treatmentForm) treatmentForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const data = Object.fromEntries(new FormData(treatmentForm).entries());
        const res = await fetchApi(editingTreatmentId ? `/treatments/${editingTreatmentId}` : '/treatments', editingTreatmentId ? 'PUT' : 'POST', data);
        if (res && res.status === 'success') {
            treatmentModal.classList.add('hidden');
            loadTreatments();
            loadDropdowns();
        } else if (res && res.status === 'error') {
            alert('Error al guardar tratamiento: ' + res.message);
        }
    });

    if (appointmentForm) appointmentForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const data = Object.fromEntries(new FormData(appointmentForm).entries());
        data.cobrado = appointmentForm.querySelector('[name="cobrado"]')?.checked || false;

        // --- Conflict Detection ---
        const newDate = data.fecha;
        const newStartTime = data.hora;
        const newDuration = parseInt(data.duracion);

        const [newHours, newMinutes] = newStartTime.split(':').map(Number);
        const newStartTotalMinutes = newHours * 60 + newMinutes;
        const newEndTotalMinutes = newStartTotalMinutes + newDuration;

        const conflict = allAppointments.find(appt => {
            // Ignore self when editing
            if (editingAppointmentId && appt.id == editingAppointmentId) return false;

            // Ignore cancelled appointments
            if (appt.estado && appt.estado.toLowerCase() === 'cancelada') return false;

            // Check date match
            if (appt.fecha !== newDate) return false;

            // Check time overlap
            const [apptHours, apptMinutes] = appt.hora.split(':').map(Number);
            const apptStartTotalMinutes = apptHours * 60 + apptMinutes;
            const apptEndTotalMinutes = apptStartTotalMinutes + parseInt(appt.duracion);

            const isOverlap = (newStartTotalMinutes < apptEndTotalMinutes) && (newEndTotalMinutes > apptStartTotalMinutes);

            if (!isOverlap) return false;

            // Check resource conflicts
            const doctorConflict = appt.id_profesional == data.id_profesional;
            const roomConflict = appt.id_sala == data.id_sala;
            const patientConflict = appt.id_paciente == data.id_paciente;

            return doctorConflict || roomConflict || patientConflict;
        });

        if (conflict) {
            let conflictMsg = 'Conflicto detectado:\n';
            if (conflict.id_profesional == data.id_profesional) conflictMsg += '- El profesional ya tiene una cita en este horario.\n';
            if (conflict.id_sala == data.id_sala) conflictMsg += '- La sala está ocupada en este horario.\n';
            if (conflict.id_paciente == data.id_paciente) conflictMsg += '- El paciente ya tiene una cita en este horario.\n';
            alert(conflictMsg);
            return;
        }
        // --------------------------

        const endpoint = editingAppointmentId ? `/appointments/${editingAppointmentId}` : '/appointments';
        const method = editingAppointmentId ? 'PUT' : 'POST';
        const res = await fetchApi(endpoint, method, data);
        if (res && res.status === 'success') {
            appointmentModal.classList.add('hidden');
            loadAppointments();
            editingAppointmentId = null;
        } else if (res && res.status === 'error') {
            alert('Error al guardar cita: ' + res.message);
        }
    });

    if (roomForm) roomForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const data = Object.fromEntries(new FormData(roomForm).entries());
        const res = await fetchApi(editingRoomId ? `/rooms/${editingRoomId}` : '/rooms', editingRoomId ? 'PUT' : 'POST', data);
        if (res && res.status === 'success') {
            roomModal.classList.add('hidden');
            loadRooms();
            loadDropdowns();
        } else if (res && res.status === 'error') {
            alert('Error al guardar sala: ' + res.message);
        }
    });

    const userForm = document.getElementById('userForm');
    if (userForm) userForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const data = Object.fromEntries(new FormData(userForm).entries());
        if (!editingUserId && !data.password) {
            alert('La contraseña es obligatoria para nuevos usuarios');
            return;
        }
        const endpoint = editingUserId ? `/users/${editingUserId}` : '/users';
        const method = editingUserId ? 'PUT' : 'POST';
        const res = await fetchApi(endpoint, method, data);
        if (res && res.status === 'success') {
            document.getElementById('userModal').classList.add('hidden');
            loadUsers();
        } else if (res && res.message) {
            alert(res.message);
        }
    });

    if (teamForm) teamForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const data = Object.fromEntries(new FormData(teamForm).entries());
        const res = await fetchApi(editingProfessionalId ? `/professionals/${editingProfessionalId}` : '/professionals', editingProfessionalId ? 'PUT' : 'POST', data);
        if (res && res.status === 'success') {
            teamModal.classList.add('hidden');
            loadTeam();
            loadDropdowns();
        } else if (res && res.status === 'error') {
            alert('Error al guardar miembro del equipo: ' + res.message);
        }
    });

    if (inventoryForm) inventoryForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const data = Object.fromEntries(new FormData(inventoryForm).entries());

        console.log('Enviando formulario de inventario:', data);

        const endpoint = editingInventoryId ? `/inventory/${editingInventoryId}` : '/inventory';
        const method = editingInventoryId ? 'PUT' : 'POST';

        const res = await fetchApi(endpoint, method, data);
        console.log('Respuesta del servidor:', res);

        if (res && res.status === 'success') {
            inventoryModal.classList.add('hidden');
            loadInventory();
        } else if (res && res.status === 'error') {
            alert('Error al guardar producto: ' + res.message);
        } else {
            alert('Error desconocido al guardar el producto. Por favor, revise los datos.');
        }
    });

    if (uploadForm) uploadForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const formData = new FormData(uploadForm);

        try {
            const response = await fetch(`${API_URL}/consent`, {
                method: 'POST',
                body: formData
            });
            const res = await response.json();
            if (res && res.status === 'success') {
                uploadFormModal.classList.add('hidden');
                uploadForm.reset();
                loadConsentDocuments();
            } else {
                alert('Error al subir el archivo: ' + (res.message || 'Error desconocido'));
            }
        } catch (error) {
            console.error('Error uploading file:', error);
            alert('Error en la conexión con el servidor');
        }
    });

    if (stockAdjustmentForm) stockAdjustmentForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = document.getElementById('stockAdjustmentId').value;
        const type = document.getElementById('stockAdjustmentType').value;
        const quantity = parseFloat(document.getElementById('stockAdjustmentQuantity').value);

        const item = allInventory.find(i => i.id == id);
        if (!item) return;

        let newQuantity = parseFloat(item.cantidad);
        if (type === 'add') {
            newQuantity += quantity;
        } else if (type === 'remove') {
            newQuantity -= quantity;
        }

        if (newQuantity < 0) newQuantity = 0;

        // Optimistic update
        item.cantidad = newQuantity;
        renderInventory(allInventory);
        stockAdjustmentModal.classList.add('hidden');

        const res = await fetchApi(`/inventory/${id}`, 'PUT', { ...item, cantidad: newQuantity });
        if (!res || res.status !== 'success') {
            alert('Error al actualizar el stock');
            loadInventory(); // Revert
        } else {
            updateDashboardMetrics();
        }
    });

    // --- Generic Modal Closers ---
    document.querySelectorAll('.modal-overlay').forEach(modal => {
        modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.add('hidden'); });
    });
    document.querySelectorAll('.btn-icon .fa-xmark, .btn-neutral').forEach(btn => {
        const btnElement = btn.closest('button') || btn;
        btnElement.addEventListener('click', () => {
            const modal = btn.closest('.modal-overlay');
            if (modal) modal.classList.add('hidden');
        });
    });

    async function loadClinicInfo() {
        const clinic = await fetchApi('/clinic');
        if (clinic) {
            const form = document.getElementById('clinicForm');
            if (form) {
                form.nombre.value = clinic.nombre || '';
                form.direccion.value = clinic.direccion || '';
                form.telefono.value = clinic.telefono || '';
                form.email.value = clinic.email || '';
                form.cif.value = clinic.cif || '';
                form.web.value = clinic.web || '';
            }
        }
    }

    async function saveClinicInfo() {
        const form = document.getElementById('clinicForm');
        const data = Object.fromEntries(new FormData(form).entries());
        const res = await fetchApi('/clinic', 'PUT', data);
        if (res && res.status === 'success') {
            alert('Información de la clínica guardada correctamente');
        }
    }

    async function loadSchedule() {
        const schedules = await fetchApi('/schedule');
        const container = document.getElementById('schedule-list');
        if (container && schedules) {
            container.innerHTML = '';
            schedules.forEach(day => {
                const dayRow = document.createElement('div');
                dayRow.className = 'schedule-row';

                dayRow.innerHTML = `
                    <span class="day-name">${day.dia_semana}</span>
                    <label class="premium-switch">
                        <input type="checkbox" class="day-toggle" data-day="${day.dia_semana}" ${day.abierto ? 'checked' : ''}>
                        <span class="premium-slider"></span>
                    </label>
                    <div class="time-inputs" style="display: ${day.abierto ? 'flex' : 'none'};">
                        <input type="time" class="modern-time-input open-time" value="${day.hora_apertura || '09:00'}">
                        <span class="time-dash">—</span>
                        <input type="time" class="modern-time-input close-time" value="${day.hora_cierre || '18:00'}">
                    </div>
                `;
                container.appendChild(dayRow);
            });

            // Add listeners to toggles
            container.querySelectorAll('.day-toggle').forEach(toggle => {
                toggle.addEventListener('change', (e) => {
                    const timeInputs = e.target.closest('.schedule-row').querySelector('.time-inputs');
                    timeInputs.style.display = e.target.checked ? 'flex' : 'none';
                });
            });
        }
    }

    async function saveSchedule() {
        const saveBtn = document.getElementById('saveScheduleBtn');
        const originalContent = saveBtn.innerHTML;

        try {
            saveBtn.disabled = true;
            saveBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Guardando...';

            const rows = document.querySelectorAll('.schedule-row');
            const data = Array.from(rows).map(row => ({
                dia_semana: row.querySelector('.day-toggle').dataset.day,
                abierto: row.querySelector('.day-toggle').checked ? 1 : 0,
                hora_apertura: row.querySelector('.open-time').value,
                hora_cierre: row.querySelector('.close-time').value
            }));

            const res = await fetchApi('/schedule', 'POST', data);
            if (res && res.status === 'success') {
                alert('Horarios guardados correctamente');
                loadSchedule(); // Refresh
            }
        } catch (error) {
            console.error('Error al guardar horarios:', error);
            alert('Error al guardar los horarios');
        } finally {
            saveBtn.disabled = false;
            saveBtn.innerHTML = originalContent;
        }
    }

    if (document.getElementById('saveClinicBtn')) {
        document.getElementById('saveClinicBtn').addEventListener('click', saveClinicInfo);
    }
    if (document.getElementById('saveScheduleBtn')) {
        document.getElementById('saveScheduleBtn').addEventListener('click', saveSchedule);
    }

    if (document.getElementById('addPatientBtn')) document.getElementById('addPatientBtn').addEventListener('click', () => { editingPatientId = null; document.querySelector('#patientModal h2').innerText = 'Añadir Nuevo Paciente'; if (patientForm) patientForm.reset(); if (patientModal) patientModal.classList.remove('hidden'); });
    if (document.getElementById('newAppointmentBtn')) document.getElementById('newAppointmentBtn').addEventListener('click', () => {
        if (appointmentForm) {
            appointmentForm.reset();
            const cobradoInput = appointmentForm.querySelector('[name="cobrado"]');
            if (cobradoInput) cobradoInput.checked = false;
        }
        editingAppointmentId = null;
        document.getElementById('appointmentModalTitle').innerText = 'Nueva Cita';
        lastSelectedPatientName = '';
        const apptResults = document.getElementById('apptPatientResults');
        if (apptResults) {
            apptResults.classList.add('hidden');
            apptResults.innerHTML = '';
        }
        if (appointmentModal) appointmentModal.classList.remove('hidden');
    });
    if (document.getElementById('newTreatmentBtn')) document.getElementById('newTreatmentBtn').addEventListener('click', () => { editingTreatmentId = null; document.querySelector('#treatmentModal h2').innerText = 'Nuevo Tratamiento'; treatmentForm.reset(); treatmentModal.classList.remove('hidden'); });
    if (document.getElementById('addRoomBtn')) document.getElementById('addRoomBtn').addEventListener('click', () => { editingRoomId = null; document.querySelector('#roomModal h2').innerText = 'Nueva Sala'; roomForm.reset(); roomModal.classList.remove('hidden'); });
    if (document.getElementById('addTeamMemberBtn')) document.getElementById('addTeamMemberBtn').addEventListener('click', () => { editingProfessionalId = null; document.querySelector('#teamModal h2').innerText = 'Nuevo Miembro del Equipo'; teamForm.reset(); teamModal.classList.remove('hidden'); });
    if (document.getElementById('addInventoryBtn')) document.getElementById('addInventoryBtn').addEventListener('click', () => { editingInventoryId = null; document.querySelector('#inventoryModal h2').innerText = 'Nuevo Producto'; inventoryForm.reset(); inventoryModal.classList.remove('hidden'); });
    if (document.getElementById('uploadFormBtn')) document.getElementById('uploadFormBtn').addEventListener('click', () => { uploadForm.reset(); uploadFormModal.classList.remove('hidden'); });
    if (document.getElementById('addUserBtn')) document.getElementById('addUserBtn').addEventListener('click', () => {
        editingUserId = null;
        document.getElementById('userModalTitle').innerText = 'Nuevo Usuario';
        const form = document.getElementById('userForm');
        form.reset();
        form.password.required = true;
        document.getElementById('passwordHelp').style.display = 'none';
        document.getElementById('userModal').classList.remove('hidden');
    });

    if (document.getElementById('openKioskBtn')) {
        document.getElementById('openKioskBtn').addEventListener('click', () => {
            const activeClinicDb = localStorage.getItem('dentia_active_clinic_db');
            let url = 'kiosk.html';
            let params = new URLSearchParams();
            if (activeClinicDb) params.append('clinicDb', activeClinicDb);
            if (currentUser && currentUser.id_clinica) params.append('clinicId', currentUser.id_clinica);
            
            if (params.toString()) {
                url += '?' + params.toString();
            }
            window.open(url, '_blank', 'noopener,noreferrer');
        });
    }

    // Filter modal handlers
    const filterModal = document.getElementById('filterModal');
    const filterForm = document.getElementById('filterForm');
    const filterAppointmentsBtn = document.getElementById('filterAppointmentsBtn');
    const toggleCalendarViewBtn = document.getElementById('toggleCalendarViewBtn');
    const closeFilterModalBtn = document.getElementById('closeFilterModalBtn');
    const cancelFilterBtn = document.getElementById('cancelFilterBtn');
    const clearFiltersBtn = document.getElementById('clearFiltersBtn');

    if (toggleCalendarViewBtn) {
        toggleCalendarViewBtn.addEventListener('click', () => {
            currentCalendarView = currentCalendarView === 'cards' ? 'agenda' : 'cards';
            toggleCalendarViewBtn.innerHTML = currentCalendarView === 'cards' ? '<i class="fa-solid fa-calendar-week"></i> Vista Semanal' : '<i class="fa-solid fa-grip"></i> Vista Tarjetas';
            renderAppointments();
        });
    }

    if (filterAppointmentsBtn) filterAppointmentsBtn.addEventListener('click', () => {
        filterModal.classList.remove('hidden');
    });

    if (closeFilterModalBtn) closeFilterModalBtn.addEventListener('click', () => {
        filterModal.classList.add('hidden');
    });

    if (cancelFilterBtn) cancelFilterBtn.addEventListener('click', () => {
        filterModal.classList.add('hidden');
    });

    if (clearFiltersBtn) clearFiltersBtn.addEventListener('click', () => {
        appointmentFilters = {
            id_profesional: '',
            id_sala: '',
            id_tratamiento: '',
            paciente: '',
            fecha_desde: '',
            fecha_hasta: ''
        };
        filterForm.reset();
        renderAppointments();
        filterModal.classList.add('hidden');
    });

    if (filterForm) filterForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const formData = new FormData(filterForm);
        appointmentFilters = {
            id_profesional: formData.get('id_profesional') || '',
            id_sala: formData.get('id_sala') || '',
            id_tratamiento: formData.get('id_tratamiento') || '',
            paciente: formData.get('paciente') || '',
            fecha_desde: formData.get('fecha_desde') || '',
            fecha_hasta: formData.get('fecha_hasta') || ''
        };
        renderAppointments();
        filterModal.classList.add('hidden');
    });

    // --- 3D Simulator Logic ---
    const simDropzone = document.getElementById('simDropzone');
    const simFileInput = document.getElementById('simFileInput');
    const simPreviewContainer = document.getElementById('simPreviewContainer');
    const simPreviewImage = document.getElementById('simPreviewImage');
    const removeSimImage = document.getElementById('removeSimImage');
    const startSimBtn = document.getElementById('startSimBtn');
    const resetSimBtn = document.getElementById('resetSimBtn');
    const simStatus = document.getElementById('simStatus');
    const simBrightness = document.getElementById('simBrightness');
    const simContrast = document.getElementById('simContrast');

    let originalSimImage = '';

    if (simDropzone && simFileInput) {
        simDropzone.addEventListener('click', () => simFileInput.click());

        simFileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) handleSimFile(file);
        });

        simDropzone.addEventListener('dragover', (e) => {
            e.preventDefault();
            simDropzone.style.borderColor = 'var(--primary-color)';
            simDropzone.style.background = 'rgba(59, 130, 246, 0.1)';
        });

        simDropzone.addEventListener('dragleave', () => {
            simDropzone.style.borderColor = 'var(--border-color)';
            simDropzone.style.background = 'rgba(255,255,255,0.05)';
        });

        simDropzone.addEventListener('drop', (e) => {
            e.preventDefault();
            simDropzone.style.borderColor = 'var(--border-color)';
            simDropzone.style.background = 'rgba(255,255,255,0.05)';
            const file = e.dataTransfer.files[0];
            if (file && file.type.startsWith('image/')) handleSimFile(file);
        });
    }

    function handleSimFile(file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            originalSimImage = e.target.result;
            simPreviewImage.src = e.target.result;
            simDropzone.classList.add('hidden');
            simPreviewContainer.classList.remove('hidden');
            resetSimSettings();
        };
        reader.readAsDataURL(file);
    }

    function resetSimSettings() {
        if (simBrightness) {
            simBrightness.value = 100;
            updateSliderFill(simBrightness);
        }
        if (simContrast) {
            simContrast.value = 100;
            updateSliderFill(simContrast);
        }
        updateSimFilters();
    }

    function updateSliderFill(input) {
        if (!input) return;
        const min = input.min || 0;
        const max = input.max || 100;
        const val = input.value;
        const percentage = (val - min) / (max - min) * 100;
        input.style.background = `linear-gradient(to right, var(--primary-color) 0%, var(--primary-color) ${percentage}%, #e2e8f0 ${percentage}%, #e2e8f0 100%)`;
    }

    function updateSimFilters(e) {
        if (e && e.target) updateSliderFill(e.target);
        if (!simPreviewImage) return;
        const brightness = simBrightness ? simBrightness.value : 100;
        const contrast = simContrast ? simContrast.value : 100;
        simPreviewImage.style.filter = `brightness(${brightness}%) contrast(${contrast}%)`;
    }

    if (simBrightness) simBrightness.addEventListener('input', updateSimFilters);
    if (simContrast) simContrast.addEventListener('input', updateSimFilters);

    if (removeSimImage) {
        removeSimImage.addEventListener('click', () => {
            simPreviewImage.src = '#';
            simPreviewContainer.classList.add('hidden');
            simDropzone.classList.remove('hidden');
            simFileInput.value = '';
            originalSimImage = '';
        });
    }

    if (resetSimBtn) {
        resetSimBtn.addEventListener('click', () => {
            if (originalSimImage) {
                simPreviewImage.src = originalSimImage;
                resetSimSettings();
            }
        });
    }

    if (startSimBtn) {
        startSimBtn.addEventListener('click', async () => {
            if (!originalSimImage) {
                alert('Por favor, sube una imagen primero.');
                return;
            }

            const treatment = document.querySelector('input[name="simTreatment"]:checked')?.value || 'whitening';

            simStatus.classList.remove('hidden');
            startSimBtn.disabled = true;

            try {
                const response = await fetch('/api/simulate', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        image: originalSimImage,
                        treatment: treatment
                    })
                });

                const result = await response.json();

                if (result.status === 'success') {
                    simPreviewImage.src = result.image_url;
                } else {
                    alert('Error en la simulación: ' + result.message);
                }
            } catch (error) {
                console.error('Error:', error);
                alert('Error al conectar con el servidor de IA.');
            } finally {
                simStatus.classList.add('hidden');
                startSimBtn.disabled = false;
            }
        });
    }

    // --- Initialize App ---
    initApp();

    // --- PRESUPUESTOS LOGIC ---
    let availableTreatments = [];

    window.openCreatePresupuestoModal = async () => {
        // Load patients for selector
        const patients = await fetchApi('/patients');
        const patientSelect = document.getElementById('budgetPatientId');
        if (patientSelect && patients) {
            patientSelect.innerHTML = '<option value="">Seleccionar paciente...</option>' + 
                patients.map(p => `<option value="${p.id}">${p.nombre} ${p.apellidos}</option>`).join('');
        }

        // Load treatments for items
        availableTreatments = await fetchApi('/treatments');
        
        // Reset form
        const itemsBody = document.getElementById('budgetItemsBody');
        if (itemsBody) itemsBody.innerHTML = '';
        
        const notesInput = document.getElementById('budgetNotes');
        if (notesInput) notesInput.value = '';
        
        const totalVal = document.getElementById('budgetTotalValue');
        if (totalVal) totalVal.textContent = '0.00 €';
        
        // Add first row
        addBudgetItemRow();
        
        const modal = document.getElementById('createPresupuestoModal');
        if (modal) modal.classList.remove('hidden');
    };

    window.addBudgetItemRow = () => {
        const tbody = document.getElementById('budgetItemsBody');
        if (!tbody) return;

        const rowId = Date.now();
        const tr = document.createElement('tr');
        tr.id = `row-${rowId}`;
        
        tr.innerHTML = `
            <td>
                <select class="form-input treatment-select" onchange="updateBudgetItemRow(${rowId})" required style="width: 100%;">
                    <option value="">Seleccionar...</option>
                    ${availableTreatments.map(t => `<option value="${t.id}" data-price="${t.precio}">${t.nombre}</option>`).join('')}
                </select>
            </td>
            <td><input type="number" class="form-input qty-input" value="1" min="1" onchange="updateBudgetItemRow(${rowId})" required style="width: 100%;"></td>
            <td><input type="number" class="form-input price-input" step="0.01" onchange="updateBudgetItemRow(${rowId})" required style="width: 100%;"></td>
            <td><input type="number" class="form-input discount-input" value="0" min="0" max="100" onchange="updateBudgetItemRow(${rowId})" style="width: 100%;"></td>
            <td class="row-total" style="font-weight: 700;">0.00 €</td>
            <td><button type="button" class="btn-icon" onclick="removeBudgetItemRow(${rowId})" style="color: #ef4444;"><i class="fa-solid fa-times"></i></button></td>
        `;
        
        tbody.appendChild(tr);
    };

    window.removeBudgetItemRow = (rowId) => {
        const row = document.getElementById(`row-${rowId}`);
        if (row) row.remove();
        calculateBudgetTotal();
    };

    window.updateBudgetItemRow = (rowId) => {
        const row = document.getElementById(`row-${rowId}`);
        if (!row) return;

        const select = row.querySelector('.treatment-select');
        const qty = row.querySelector('.qty-input').value || 1;
        const priceInput = row.querySelector('.price-input');
        const discount = row.querySelector('.discount-input').value || 0;
        
        // Detectar si el tratamiento ha cambiado de forma robusta e independiente de window.event
        const currentVal = select.value;
        const prevVal = select.dataset.prevVal || "";
        if (currentVal !== prevVal) {
            select.dataset.prevVal = currentVal;
            const selectedOption = select.options[select.selectedIndex];
            if (selectedOption && selectedOption.value) {
                priceInput.value = selectedOption.getAttribute('data-price') || 0;
            } else {
                priceInput.value = "";
            }
        }
        
        const price = priceInput.value || 0;
        const total = (qty * price) * (1 - discount / 100);
        row.querySelector('.row-total').textContent = `${total.toFixed(2)} €`;
        
        calculateBudgetTotal();
    };

    function calculateBudgetTotal() {
        const rows = document.querySelectorAll('#budgetItemsBody tr');
        let total = 0;
        rows.forEach(row => {
            const rowTotalText = row.querySelector('.row-total').textContent;
            total += parseFloat(rowTotalText.replace(' €', ''));
        });
        const totalEl = document.getElementById('budgetTotalValue');
        if (totalEl) totalEl.textContent = `${total.toFixed(2)} €`;
    }

    const createPresupuestoForm = document.getElementById('createPresupuestoForm');
    if (createPresupuestoForm) {
        createPresupuestoForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const rows = document.querySelectorAll('#budgetItemsBody tr');
            const items = Array.from(rows).map(row => ({
                id_tratamiento: row.querySelector('.treatment-select').value,
                cantidad: parseInt(row.querySelector('.qty-input').value),
                precio_unitario: parseFloat(row.querySelector('.price-input').value),
                descuento_percent: parseFloat(row.querySelector('.discount-input').value),
                total: parseFloat(row.querySelector('.row-total').textContent.replace(' €', ''))
            }));
            
            const totalText = document.getElementById('budgetTotalValue').textContent;
            const total = parseFloat(totalText.replace(' €', ''));
            
            const res = await fetchApi('/presupuestos', 'POST', {
                id_paciente: document.getElementById('budgetPatientId').value,
                notas: document.getElementById('budgetNotes').value,
                items: items,
                total: total
            });
            
            if (res && res.status === 'success') {
                const modal = document.getElementById('createPresupuestoModal');
                if (modal) modal.classList.add('hidden');
                loadPresupuestos();
            }
        });
    }

    window.changePresupuestoStatus = async (id, status) => {
        const res = await fetchApi(`/presupuestos/${id}/status`, 'PATCH', { estado: status });
        if (res && res.status === 'success') {
            loadPresupuestos();
        }
    };

    window.deletePresupuesto = async (id) => {
        if (!confirm('¿Seguro que quieres eliminar este presupuesto?')) return;
        const res = await fetchApi(`/presupuestos/${id}`, 'DELETE');
        if (res && res.status === 'success') {
            loadPresupuestos();
        }
    };

    const searchPresupuestosInput = document.getElementById('searchPresupuestos');
    if (searchPresupuestosInput) {
        searchPresupuestosInput.addEventListener('input', () => {
            // We need the full list to filter client-side or just re-fetch
            loadPresupuestos();
        });
    }

    const filterPresupuestoStatus = document.getElementById('filterPresupuestoStatus');
    if (filterPresupuestoStatus) {
        filterPresupuestoStatus.addEventListener('change', () => {
            loadPresupuestos();
        });
    }

    window.downloadPresupuestoPdf = async (id) => {
        try {
            // 1. Fetch budget details (includes patient and items with treatments)
            const budget = await fetchApi(`/presupuestos/${id}`);
            if (!budget) {
                alert('Error al cargar los detalles del presupuesto.');
                return;
            }

            // 2. Fetch clinic details
            const clinic = await fetchApi('/clinic');
            if (!clinic) {
                alert('Error al cargar los datos de la clínica.');
                return;
            }

            const patient = budget.pacientes || {};
            const items = budget.items || [];

            // 3. Populate Clinic Info
            document.getElementById('budgetPdfClinicName').textContent = clinic.nombre || 'Clínica Dental';
            document.getElementById('budgetPdfClinicAddress').textContent = clinic.direccion || 'Dirección de la clínica';
            document.getElementById('budgetPdfClinicPhone').textContent = clinic.telefono || '';
            document.getElementById('budgetPdfClinicEmail').textContent = clinic.email || '';
            document.getElementById('budgetPdfClinicCif').textContent = clinic.cif || '';

            // 4. Populate Budget Header
            document.getElementById('budgetPdfNumber').textContent = budget.numero_presupuesto;
            document.getElementById('budgetPdfDate').textContent = budget.fecha;
            document.getElementById('budgetPdfNotes').textContent = budget.notas || 'Sin notas adicionales.';

            // 5. Populate Patient Info
            document.getElementById('budgetPdfPatientName').textContent = `${patient.nombre || ''} ${patient.apellidos || ''}`;
            document.getElementById('budgetPdfPatientDni').textContent = `DNI/NIE: ${patient.dni || '--'}`;
            document.getElementById('budgetPdfPatientPhone').textContent = `Tel: ${patient.telefono || '--'}`;
            
            let addrParts = [patient.calle, patient.numero_calle, patient.municipio, patient.poblacion_provincia].filter(Boolean);
            document.getElementById('budgetPdfPatientAddress').textContent = addrParts.join(', ') || 'Dirección no especificada';

            // 6. Populate Items Table
            const itemsBody = document.getElementById('budgetPdfItemsBody');
            itemsBody.innerHTML = items.map(item => {
                const treatmentName = item.tratamientos ? item.tratamientos.nombre : 'Tratamiento Desconocido';
                return `
                    <tr>
                        <td style="padding: 12px; border-bottom: 1px solid #e2e8f0; color: #0f172a;">${treatmentName}</td>
                        <td style="padding: 12px; border-bottom: 1px solid #e2e8f0; text-align: center;">${item.cantidad}</td>
                        <td style="padding: 12px; border-bottom: 1px solid #e2e8f0; text-align: right;">${item.precio_unitario.toFixed(2)} €</td>
                        <td style="padding: 12px; border-bottom: 1px solid #e2e8f0; text-align: center;">${item.descuento_percent}%</td>
                        <td style="padding: 12px; border-bottom: 1px solid #e2e8f0; text-align: right; font-weight: 600;">${item.total.toFixed(2)} €</td>
                    </tr>
                `;
            }).join('');

            // 7. Set Total
            document.getElementById('budgetPdfTotalAmount').textContent = `${budget.total.toFixed(2)} €`;

            // 8. Generate PDF
            const element = document.getElementById('budgetPdfTemplate');
            element.style.display = 'block'; // Show to render

            const opt = {
                margin:       10,
                filename:     `Presupuesto_${budget.numero_presupuesto}.pdf`,
                image:        { type: 'jpeg', quality: 0.98 },
                html2canvas:  { scale: 2 },
                jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' }
            };

            await html2pdf().set(opt).from(element).save();

            element.style.display = 'none'; // Hide again
        } catch (error) {
            console.error('Error al generar PDF del presupuesto:', error);
            alert('Ocurrió un error al intentar generar el PDF.');
        }
    };

    // --- MARKETING & CAMPAIGNS LOGIC ---
    let allCampaigns = [];

    async function loadMarketingCampaigns() {
        try {
            let res;
            if (window.isGuestMode) {
                const stored = localStorage.getItem('dentia_mock_campaigns');
                allCampaigns = stored ? JSON.parse(stored) : getInitialMockCampaigns();
            } else {
                res = await fetchApi('/config/marketing_campaigns');
                allCampaigns = (res && res.status === 'success' && res.data) ? res.data : [];
            }

            renderCampaigns();
        } catch (error) {
            console.error('Error loading campaigns:', error);
        }
    }

    function getInitialMockCampaigns() {
        const mock = [
            { nombre: 'Revisión Anual 2026', canal: 'Email', segmento: 'Todos', fecha: '2026-01-15', mensaje: 'Hola, es momento de tu revisión dental anual gratis.', estado: 'Enviada' },
            { nombre: 'Campaña Reactivación', canal: 'SMS', segmento: 'Inactivos', fecha: '2026-03-10', mensaje: 'Te extrañamos en Dentia. Agenda hoy y recibe 10% de descuento.', estado: 'Enviada' }
        ];
        localStorage.setItem('dentia_mock_campaigns', JSON.stringify(mock));
        return mock;
    }

    function renderCampaigns() {
        const tbody = document.getElementById('campaignsListBody');
        if (!tbody) return;

        // Calculate counts
        const smsCount = allCampaigns.filter(c => c.canal === 'SMS').length;
        const emailCount = allCampaigns.filter(c => c.canal === 'Email').length;

        document.getElementById('marketingTotalCampaigns').textContent = allCampaigns.length;
        document.getElementById('marketingTotalSms').textContent = smsCount * 125; // Simulated volume
        document.getElementById('marketingTotalEmails').textContent = emailCount * 340; // Simulated volume

        if (allCampaigns.length === 0) {
            tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--secondary-color); padding: 2rem;">No hay campañas de marketing registradas.</td></tr>`;
            return;
        }

        tbody.innerHTML = allCampaigns.map(c => {
            const statusClass = c.estado === 'Enviada' ? 'status-badge active' : 'status-badge';
            const dateStr = c.fecha ? new Date(c.fecha).toLocaleDateString('es-ES') : '--';
            return `
                <tr>
                    <td style="font-weight: 600; color: #0f172a;">${c.nombre}</td>
                    <td><span style="display:inline-flex; align-items:center; gap:5px;"><i class="${c.canal === 'SMS' ? 'fa-solid fa-comment-sms' : 'fa-solid fa-envelope'}"></i> ${c.canal}</span></td>
                    <td>${c.segmento}</td>
                    <td>${dateStr}</td>
                    <td><span class="${statusClass}" style="background: ${c.estado === 'Enviada' ? 'rgba(16, 185, 129, 0.1)' : '#f1f5f9'}; color: ${c.estado === 'Enviada' ? '#10b981' : '#64748b'};">${c.estado}</span></td>
                </tr>
            `;
        }).join('');
    }

    window.openCreateCampaignModal = () => {
        const form = document.getElementById('createCampaignForm');
        if (form) form.reset();
        
        const progressContainer = document.getElementById('campaignProgressContainer');
        if (progressContainer) progressContainer.classList.add('hidden');

        const submitBtn = document.getElementById('sendCampaignSubmitBtn');
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Enviar Campaña';
        }

        const modal = document.getElementById('createCampaignModal');
        if (modal) modal.classList.remove('hidden');
    };

    const createCampaignForm = document.getElementById('createCampaignForm');
    if (createCampaignForm) {
        createCampaignForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            const submitBtn = document.getElementById('sendCampaignSubmitBtn');
            const progressContainer = document.getElementById('campaignProgressContainer');
            const progressBar = document.getElementById('campaignProgressBar');
            const progressText = document.getElementById('campaignProgressText');

            submitBtn.disabled = true;
            submitBtn.textContent = 'Procesando...';
            progressContainer.classList.remove('hidden');

            // Simulated Sending Progress Bar
            let percent = 0;
            const interval = setInterval(() => {
                percent += 5;
                if (progressBar) progressBar.style.width = `${percent}%`;
                if (progressText) progressText.textContent = `${percent}%`;

                if (percent >= 100) {
                    clearInterval(interval);
                    completeCampaignSend();
                }
            }, 80);

            async function completeCampaignSend() {
                const formData = new FormData(createCampaignForm);
                const newCamp = {
                    nombre: formData.get('nombre'),
                    canal: formData.get('canal'),
                    segmento: formData.get('segmento'),
                    mensaje: formData.get('mensaje'),
                    fecha: new Date().toISOString().split('T')[0],
                    estado: 'Enviada'
                };

                allCampaigns.unshift(newCamp);

                if (window.isGuestMode) {
                    localStorage.setItem('dentia_mock_campaigns', JSON.stringify(allCampaigns));
                } else {
                    await fetchApi('/config/marketing_campaigns', 'POST', { valor: allCampaigns });
                }

                closeModal('createCampaignModal');
                renderCampaigns();
                alert('¡Campaña enviada con éxito a los destinatarios del segmento seleccionado!');
            }
        });
    }

    // --- INTEGRATIONS LOGIC ---
    let allIntegrations = {
        google: { connected: false },
        stripe: { connected: false },
        whatsapp: { connected: false },
        twilio: { connected: false }
    };

    async function loadIntegrations() {
        try {
            let res;
            if (window.isGuestMode) {
                const stored = localStorage.getItem('dentia_mock_integrations');
                allIntegrations = stored ? JSON.parse(stored) : getInitialMockIntegrations();
            } else {
                res = await fetchApi('/config/integrations');
                allIntegrations = (res && res.status === 'success' && res.data) ? res.data : getInitialMockIntegrations();
            }

            renderIntegrationsBadges();
        } catch (error) {
            console.error('Error loading integrations:', error);
        }
    }

    function getInitialMockIntegrations() {
        return {
            google: { connected: false },
            stripe: { connected: false },
            whatsapp: { connected: false },
            twilio: { connected: false }
        };
    }

    function renderIntegrationsBadges() {
        const services = ['google', 'stripe', 'whatsapp', 'twilio'];
        services.forEach(s => {
            const badge = document.getElementById(`int-${s}-status`);
            if (badge) {
                const isConnected = allIntegrations[s] && allIntegrations[s].connected;
                if (isConnected) {
                    badge.textContent = 'Conectado';
                    badge.className = 'status-badge active';
                    badge.style.background = 'rgba(16, 185, 129, 0.1)';
                    badge.style.color = '#10b981';
                } else {
                    badge.textContent = 'Inactivo';
                    badge.className = 'status-badge inactive';
                    badge.style.background = '#f1f5f9';
                    badge.style.color = '#64748b';
                }
            }
        });
    }

    window.openIntegrationModal = (service) => {
        document.getElementById('intServiceId').value = service;
        const container = document.getElementById('intFieldsContainer');
        const disconnectBtn = document.getElementById('disconnectIntegrationBtn');
        const form = document.getElementById('integrationConfigForm');

        form.reset();
        container.innerHTML = '';

        const data = allIntegrations[service] || { connected: false };
        if (data.connected) {
            disconnectBtn.style.display = 'block';
        } else {
            disconnectBtn.style.display = 'none';
        }

        if (service === 'google') {
            document.getElementById('intModalTitle').textContent = 'Configurar Google Calendar';
            container.innerHTML = `
                <div class="form-group">
                    <label>Google Client ID</label>
                    <input type="text" name="clientId" class="form-input" placeholder="Google OAuth Client ID" value="${data.clientId || ''}" required>
                </div>
                <div class="form-group">
                    <label>Google Client Secret</label>
                    <input type="password" name="clientSecret" class="form-input" placeholder="••••••••••••••••••••" value="${data.clientSecret ? 'secret_configured' : ''}" required>
                </div>
            `;
        } else if (service === 'stripe') {
            document.getElementById('intModalTitle').textContent = 'Configurar Stripe Pagos';
            container.innerHTML = `
                <div class="form-group">
                    <label>Stripe Publishable Key</label>
                    <input type="text" name="publishableKey" class="form-input" placeholder="pk_live_..." value="${data.publishableKey || ''}" required>
                </div>
                <div class="form-group">
                    <label>Stripe Secret Key</label>
                    <input type="password" name="secretKey" class="form-input" placeholder="sk_live_..." value="${data.secretKey || ''}" required>
                </div>
            `;
        } else if (service === 'whatsapp') {
            document.getElementById('intModalTitle').textContent = 'Configurar WhatsApp Business';
            container.innerHTML = `
                <div class="form-group">
                    <label>WhatsApp Phone Number ID</label>
                    <input type="text" name="phoneId" class="form-input" placeholder="Ej: 1042340529340" value="${data.phoneId || ''}" required>
                </div>
                <div class="form-group">
                    <label>System User Access Token</label>
                    <input type="password" name="accessToken" class="form-input" placeholder="Token permanente de Meta..." value="${data.accessToken || ''}" required>
                </div>
            `;
        } else if (service === 'twilio') {
            document.getElementById('intModalTitle').textContent = 'Configurar Twilio SMS Gateway';
            container.innerHTML = `
                <div class="form-group">
                    <label>Account SID</label>
                    <input type="text" name="accountSid" class="form-input" placeholder="AC..." value="${data.accountSid || ''}" required>
                </div>
                <div class="form-group">
                    <label>Auth Token</label>
                    <input type="password" name="authToken" class="form-input" placeholder="••••••••••••••••••••" value="${data.authToken || ''}" required>
                </div>
                <div class="form-group">
                    <label>Twilio Phone Number</label>
                    <input type="text" name="phoneNumber" class="form-input" placeholder="Ej: +14155552671" value="${data.phoneNumber || ''}" required>
                </div>
            `;
        }

        const modal = document.getElementById('integrationConfigModal');
        if (modal) modal.classList.remove('hidden');
    };

    const integrationConfigForm = document.getElementById('integrationConfigForm');
    if (integrationConfigForm) {
        integrationConfigForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const service = document.getElementById('intServiceId').value;
            const formData = new FormData(integrationConfigForm);
            
            const config = { connected: true };
            for (let [key, val] of formData.entries()) {
                if (key !== 'serviceId') config[key] = val;
            }

            allIntegrations[service] = config;

            if (window.isGuestMode) {
                localStorage.setItem('dentia_mock_integrations', JSON.stringify(allIntegrations));
            } else {
                await fetchApi('/config/integrations', 'POST', { valor: allIntegrations });
            }

            closeModal('integrationConfigModal');
            renderIntegrationsBadges();
            alert('¡Integración guardada y conectada con éxito!');
        });
    }

    const disconnectIntegrationBtn = document.getElementById('disconnectIntegrationBtn');
    if (disconnectIntegrationBtn) {
        disconnectIntegrationBtn.addEventListener('click', async () => {
            const service = document.getElementById('intServiceId').value;
            if (!confirm('¿Seguro que deseas desconectar este servicio?')) return;

            allIntegrations[service] = { connected: false };

            if (window.isGuestMode) {
                localStorage.setItem('dentia_mock_integrations', JSON.stringify(allIntegrations));
            } else {
                await fetchApi('/config/integrations', 'POST', { valor: allIntegrations });
            }

            closeModal('integrationConfigModal');
            renderIntegrationsBadges();
        });
    }

    // --- PROMOTIONS LOGIC ---
    let allPromotions = [];

    async function loadPromotions() {
        try {
            let res;
            if (window.isGuestMode) {
                const stored = localStorage.getItem('dentia_mock_promotions');
                allPromotions = stored ? JSON.parse(stored) : getInitialMockPromotions();
            } else {
                res = await fetchApi('/config/promotions');
                allPromotions = (res && res.status === 'success' && res.data) ? res.data : [];
            }

            renderPromotions();
        } catch (error) {
            console.error('Error loading promotions:', error);
        }
    }

    function getInitialMockPromotions() {
        const mock = [
            { id: 1, nombre: 'Blanqueamiento Verano', codigo: 'VERANO20', tipo: 'porcentaje', valor: 20, fecha_inicio: '2026-06-01', fecha_fin: '2026-08-31', activo: true },
            { id: 2, nombre: 'Descuento Bienvenida', codigo: 'HOLA50', tipo: 'fijo', valor: 50, fecha_inicio: '2026-01-01', fecha_fin: '2026-12-31', activo: true }
        ];
        localStorage.setItem('dentia_mock_promotions', JSON.stringify(mock));
        return mock;
    }

    function renderPromotions() {
        const tbody = document.getElementById('promosListBody');
        if (!tbody) return;

        if (allPromotions.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--secondary-color); padding: 2rem;">No hay promociones configuradas.</td></tr>`;
            return;
        }

        tbody.innerHTML = allPromotions.map(p => {
            const discountLabel = p.tipo === 'porcentaje' ? `${p.valor}%` : `${p.valor} €`;
            const dateStr = `${new Date(p.fecha_inicio).toLocaleDateString('es-ES')} - ${new Date(p.fecha_fin).toLocaleDateString('es-ES')}`;
            return `
                <tr>
                    <td style="font-weight: 600; color: #0f172a;">${p.nombre}</td>
                    <td><strong style="color:var(--primary-color);">${p.codigo}</strong></td>
                    <td>${discountLabel}</td>
                    <td style="font-size: 0.85rem; color: var(--secondary-color);">${dateStr}</td>
                    <td>
                        <label class="premium-switch">
                            <input type="checkbox" onchange="window.togglePromoActive(${p.id}, this.checked)" ${p.activo ? 'checked' : ''}>
                            <span class="premium-slider"></span>
                        </label>
                    </td>
                    <td>
                        <div style="display:flex; gap: 5px;">
                            <button type="button" class="btn-icon" onclick="window.editPromo(${p.id})" style="color:var(--primary-color);"><i class="fa-solid fa-edit"></i></button>
                            <button type="button" class="btn-icon" onclick="window.deletePromo(${p.id})" style="color:#ef4444;"><i class="fa-solid fa-trash-can"></i></button>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
    }

    window.openCreatePromoModal = () => {
        document.getElementById('promoModalTitle').textContent = 'Nueva Promoción';
        const form = document.getElementById('createPromoForm');
        form.reset();
        document.getElementById('promoId').value = '';
        form.activo.checked = true;

        const modal = document.getElementById('createPromoModal');
        if (modal) modal.classList.remove('hidden');
    };

    window.editPromo = (id) => {
        const p = allPromotions.find(x => x.id == id);
        if (!p) return;

        document.getElementById('promoModalTitle').textContent = 'Editar Promoción';
        const form = document.getElementById('createPromoForm');
        
        document.getElementById('promoId').value = p.id;
        form.nombre.value = p.nombre;
        form.codigo.value = p.codigo;
        form.tipo.value = p.tipo;
        form.valor.value = p.valor;
        form.fecha_inicio.value = p.fecha_inicio;
        form.fecha_fin.value = p.fecha_fin;
        form.activo.checked = p.activo;

        const modal = document.getElementById('createPromoModal');
        if (modal) modal.classList.remove('hidden');
    };

    window.togglePromoActive = async (id, checked) => {
        const p = allPromotions.find(x => x.id == id);
        if (p) {
            p.activo = checked;
            if (window.isGuestMode) {
                localStorage.setItem('dentia_mock_promotions', JSON.stringify(allPromotions));
            } else {
                await fetchApi('/config/promotions', 'POST', { valor: allPromotions });
            }
        }
    };

    window.deletePromo = async (id) => {
        if (!confirm('¿Seguro que deseas eliminar esta promoción?')) return;
        allPromotions = allPromotions.filter(x => x.id != id);

        if (window.isGuestMode) {
            localStorage.setItem('dentia_mock_promotions', JSON.stringify(allPromotions));
        } else {
            await fetchApi('/config/promotions', 'POST', { valor: allPromotions });
        }

        renderPromotions();
    };

    const createPromoForm = document.getElementById('createPromoForm');
    if (createPromoForm) {
        createPromoForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const formData = new FormData(createPromoForm);
            const id = document.getElementById('promoId').value;
            
            const promoData = {
                id: id ? parseInt(id) : Date.now(),
                nombre: formData.get('nombre'),
                codigo: formData.get('codigo').toUpperCase(),
                tipo: formData.get('tipo'),
                valor: parseFloat(formData.get('valor')),
                fecha_inicio: formData.get('fecha_inicio'),
                fecha_fin: formData.get('fecha_fin'),
                activo: createPromoForm.activo.checked
            };

            if (id) {
                // Update
                const index = allPromotions.findIndex(x => x.id == id);
                if (index !== -1) allPromotions[index] = promoData;
            } else {
                // Insert
                allPromotions.push(promoData);
            }

            if (window.isGuestMode) {
                localStorage.setItem('dentia_mock_promotions', JSON.stringify(allPromotions));
            } else {
                await fetchApi('/config/promotions', 'POST', { valor: allPromotions });
            }

            closeModal('createPromoModal');
            renderPromotions();
        });
    }

    // Close Modals with &times;
    window.closeModal = (id) => {
        const modal = document.getElementById(id);
        if (modal) modal.classList.add('hidden');
    };

});
