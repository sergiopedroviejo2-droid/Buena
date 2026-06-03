document.addEventListener('DOMContentLoaded', () => {
    const API_URL = window.location.protocol === 'file:' 
        ? 'http://127.0.0.1:5000/api' 
        : '/api';
    
    // Parse URL parameters
    const urlParams = new URLSearchParams(window.location.search);
    let clinicId = urlParams.get('clinicId');
    let clinicDb = urlParams.get('clinicDb');

    // UI Elements
    const stepDni = document.getElementById('step-dni');
    const stepAppointments = document.getElementById('step-appointments');
    const stepSuccess = document.getElementById('step-success');
    
    const dniInput = document.getElementById('dniInput');
    const searchBtn = document.getElementById('searchBtn');
    const errorMsg = document.getElementById('errorMsg');
    const backBtn = document.getElementById('backBtn');
    
    const appointmentsList = document.getElementById('appointmentsList');
    const noAppointmentsMsg = document.getElementById('noAppointmentsMsg');
    const loadingOverlay = document.getElementById('loadingOverlay');

    let currentPatient = null;
    let currentAppointments = [];

    // Helper to fetch data
    async function fetchApi(endpoint, method = 'GET', data = null) {
        const options = {
            method,
            headers: { 'Content-Type': 'application/json' }
        };

        if (clinicDb) {
            options.headers['X-Clinic-DB'] = clinicDb;
        }
        if (clinicId) {
            options.headers['X-Clinic-ID'] = clinicId;
        }

        if (data) options.body = JSON.stringify(data);

        try {
            const response = await fetch(`${API_URL}${endpoint}`, options);
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.message || `HTTP error! status: ${response.status}`);
            }
            return await response.json();
        } catch (error) {
            console.error(`Error fetching ${endpoint}:`, error);
            return null;
        }
    }

    // Update clinic names if available
    async function loadClinicDetails() {
        const clinic = await fetchApi('/clinic');
        if (clinic && clinic.nombre) {
            document.querySelectorAll('.clinic-name').forEach(el => {
                el.innerText = clinic.nombre;
            });
        }
    }

    // Step 1: Search DNI
    searchBtn.addEventListener('click', async () => {
        const dni = dniInput.value.trim().toUpperCase();
        if (!dni) return;

        showLoading();
        errorMsg.classList.add('hidden');

        // Fetch patients to find DNI match
        const patients = await fetchApi('/patients');
        if (!patients) {
            hideLoading();
            showError('Error de conexión.');
            return;
        }

        const patient = patients.find(p => p.dni && p.dni.toUpperCase() === dni);

        if (!patient) {
            hideLoading();
            showError('No se encontraron pacientes con este DNI.');
            return;
        }

        currentPatient = patient;

        // Fetch appointments for this patient
        const appointments = await fetchApi('/appointments');
        if (!appointments) {
            hideLoading();
            showError('Error de conexión.');
            return;
        }

        const todayStr = new Date().toISOString().split('T')[0];
        
        currentAppointments = appointments.filter(a => 
            a.id_paciente === patient.id && 
            a.fecha === todayStr &&
            (a.estado === 'programada' || a.estado === 'confirmada' || !a.estado)
        );

        hideLoading();
        showStepAppointments();
    });

    // Enter key support
    dniInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            searchBtn.click();
        }
    });

    // Step 2: Show Appointments
    function showStepAppointments() {
        stepDni.classList.add('hidden');
        stepSuccess.classList.add('hidden');
        stepAppointments.classList.remove('hidden');

        appointmentsList.innerHTML = '';

        if (currentAppointments.length === 0) {
            appointmentsList.style.display = 'none';
            noAppointmentsMsg.classList.remove('hidden');
        } else {
            appointmentsList.style.display = 'flex';
            noAppointmentsMsg.classList.add('hidden');

            // Sort by time
            currentAppointments.sort((a, b) => a.hora.localeCompare(b.hora));

            currentAppointments.forEach(appt => {
                const item = document.createElement('div');
                item.className = 'appointment-item';
                
                const formattedTime = appt.hora.substring(0, 5);
                
                item.innerHTML = `
                    <div class="appointment-info">
                        <div class="appointment-time">
                            <i class="fa-regular fa-clock"></i> ${formattedTime}
                        </div>
                        <div class="appointment-details">
                            ${appt.tratamiento_nombre || 'Tratamiento'} - ${appt.profesional_nombre || 'Especialista'}
                        </div>
                    </div>
                    <button class="btn-confirm" data-id="${appt.id}">Confirmar Llegada</button>
                `;
                appointmentsList.appendChild(item);

                // Add click listener
                const confirmBtn = item.querySelector('.btn-confirm');
                confirmBtn.addEventListener('click', () => confirmArrival(appt.id));
            });
        }
    }

    // Step 3: Confirm Arrival
    async function confirmArrival(appointmentId) {
        showLoading();
        
        const res = await fetchApi(`/appointments/${appointmentId}/status`, 'PATCH', { estado: 'en_espera' });
        
        hideLoading();
        
        if (res && res.status === 'success') {
            showStepSuccess();
        } else {
            alert('Error al confirmar llegada. Por favor, acuda a recepción.');
        }
    }

    function showStepSuccess() {
        stepDni.classList.add('hidden');
        stepAppointments.classList.add('hidden');
        stepSuccess.classList.remove('hidden');

        // Reset after 7 seconds
        setTimeout(() => {
            resetKiosk();
        }, 7000);
    }

    // Navigation and Utils
    backBtn.addEventListener('click', resetKiosk);

    function resetKiosk() {
        dniInput.value = '';
        currentPatient = null;
        currentAppointments = [];
        
        stepAppointments.classList.add('hidden');
        stepSuccess.classList.add('hidden');
        errorMsg.classList.add('hidden');
        stepDni.classList.remove('hidden');
        
        dniInput.focus();
    }

    function showLoading() {
        loadingOverlay.classList.remove('hidden');
    }

    function hideLoading() {
        loadingOverlay.classList.add('hidden');
    }

    function showError(msg) {
        errorMsg.innerText = msg;
        errorMsg.classList.remove('hidden');
    }

    // Init
    loadClinicDetails();
});
