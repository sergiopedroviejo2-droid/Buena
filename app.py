from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
import os
from datetime import date, datetime, timedelta
import json
from werkzeug.security import generate_password_hash, check_password_hash
import requests
import jwt
from functools import wraps

def token_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        auth_header = request.headers.get('Authorization', '')
        if not auth_header.startswith('Bearer '):
            return jsonify({'status': 'error', 'message': 'Token missing'}), 401
        token = auth_header.split(' ', 1)[1]
        try:
            payload = jwt.decode(token, app.config['JWT_SECRET_KEY'], algorithms=['HS256'])
            request.current_user = payload
        except Exception:
            return jsonify({'status': 'error', 'message': 'Invalid token'}), 401
        return f(*args, **kwargs)
    return decorated

from dotenv import load_dotenv
from supabase import create_client, Client

load_dotenv() # Load variables from .env


url: str = os.environ.get("SUPABASE_URL")
key: str = os.environ.get("SUPABASE_KEY")
supabase: Client = create_client(url, key)
def get_current_clinic_id():
    """Extract clinic ID from JWT token if present, otherwise fallback to headers."""
    # Try JWT token first, but if user is super-admin, prioritize header context changes
    user = getattr(request, 'current_user', None)
    is_super_admin = user and user.get('rol') == 'super-admin'
    
    if is_super_admin:
        clinic_id = request.headers.get('X-Clinic-ID')
        if clinic_id:
            return int(clinic_id)
        db_name = request.headers.get('X-Clinic-DB')
        if db_name:
            try:
                res = supabase.table("clinicas").select("id").eq("db_name", db_name).execute()
                if res.data:
                    return int(res.data[0]['id'])
            except Exception:
                pass

    if user:
        return int(user.get('id_clinica'))
    
    # Fallback to header X-Clinic-ID for guest/non-auth overrides
    clinic_id = request.headers.get('X-Clinic-ID')
    if clinic_id:
        return int(clinic_id)
    # Fallback to DB name lookup
    db_name = request.headers.get('X-Clinic-DB', 'dentia.db')
    try:
        res = supabase.table("clinicas").select("id").eq("db_name", db_name).execute()
        if res.data:
            return int(res.data[0]['id'])
    except Exception:
        pass
    return None

app = Flask(__name__, static_folder='.')
CORS(app, supports_credentials=True)
# Set max upload size to 16 MB
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024
# Load JWT secret key
app.config['JWT_SECRET_KEY'] = os.getenv('JWT_SECRET_KEY', 'change_me')

UPLOAD_FOLDER = 'uploads/consent'
try:
    if not os.path.exists(UPLOAD_FOLDER):
        os.makedirs(UPLOAD_FOLDER)
except OSError:
    # En Vercel el sistema de archivos es de solo lectura excepto /tmp
    UPLOAD_FOLDER = '/tmp/consent'
    if not os.path.exists(UPLOAD_FOLDER):
        os.makedirs(UPLOAD_FOLDER)

def roles_allowed(*roles):
    def decorator(f):
        @wraps(f)
        def wrapped(*args, **kwargs):
            user = getattr(request, 'current_user', None)
            if not user:
                return jsonify({'status': 'error', 'message': 'No user info'}), 401
            if user.get('rol') not in roles and 'super-admin' not in roles:
                return jsonify({'status': 'error', 'message': 'Insufficient permissions'}), 403
            return f(*args, **kwargs)
        return wrapped
    return decorator

def sanitize(value):
    """Converts empty strings to None for local database columns."""
    if value == "" or value is None:
        return None
    if isinstance(value, str) and value.strip() == "":
        return None
    return value

# --- Static Files Serving ---

@app.route('/')
def index():
    return send_from_directory('.', 'index.html')

@app.route('/<path:path>')
def serve_static(path):
    return send_from_directory('.', path)

@app.route('/uploads/consent/<filename>')
@token_required
def serve_consent_file(filename):
    return send_from_directory(UPLOAD_FOLDER, filename)

# --- API Endpoints ---

# Patients
# Patients
@app.route('/api/patients', methods=['GET'])
@token_required
def get_patients():
    try:
        clinic_id = get_current_clinic_id()
        res = supabase.table("pacientes").select("*").eq("id_clinica", clinic_id).execute()
        return jsonify(res.data)
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 400

@app.route('/api/patients', methods=['POST'])
@token_required
def add_patient():
    new_patient = request.json
    try:
        clinic_id = get_current_clinic_id()
        data = {
            'id_clinica': clinic_id,
            'dni': sanitize(new_patient.get('dni')),
            'nombre': sanitize(new_patient.get('nombre')),
            'apellidos': sanitize(new_patient.get('apellidos')),
            'fecha_nacimiento': sanitize(new_patient.get('fechaNacimiento')),
            'genero': sanitize(new_patient.get('genero')),
            'email': sanitize(new_patient.get('email')),
            'telefono': sanitize(new_patient.get('telefono')),
            'password_portal': sanitize(new_patient.get('password')),
            'calle': sanitize(new_patient.get('calle')),
            'numero_calle': sanitize(new_patient.get('numero_calle')),
            'escalera': sanitize(new_patient.get('escalera')),
            'piso': sanitize(new_patient.get('piso')),
            'puerta': sanitize(new_patient.get('puerta')),
            'municipio': sanitize(new_patient.get('municipio')),
            'poblacion_provincia': sanitize(new_patient.get('poblacion_provincia')),
            'cp': sanitize(new_patient.get('cp')),
            'pais': sanitize(new_patient.get('pais', 'España')),
            'alergias': sanitize(new_patient.get('alergias')),
            'problemas_medicos': sanitize(new_patient.get('problemasMedicos')),
            'medicamentos_actuales': sanitize(new_patient.get('medicamentos')),
            'cirugias_previas': sanitize(new_patient.get('cirugias')),
            'afeccion': sanitize(new_patient.get('afeccion')),
            'notas_adicionales': sanitize(new_patient.get('notas')),
            'emergencia_nombre': sanitize(new_patient.get('emergenciaNombre')),
            'emergencia_telefono': sanitize(new_patient.get('emergenciaTelefono')),
            'emergencia_relacion': sanitize(new_patient.get('emergenciaRelacion'))
        }
        # Check for duplicates
        existing = supabase.table("pacientes").select("id").eq("id_clinica", clinic_id).eq("nombre", data['nombre']).eq("apellidos", data['apellidos']).execute()
        if existing.data:
            return jsonify({'status': 'error', 'message': 'Ya existe un paciente con ese nombre y apellidos en esta clínica'}), 400

        supabase.table("pacientes").insert(data).execute()
        return jsonify({'status': 'success'}), 201
    except Exception as e:
        print(f"Error adding patient: {e}")
        return jsonify({'status': 'error', 'message': str(e)}), 400

@app.route('/api/patients/<int:id>', methods=['PUT'])
@token_required
def update_patient(id):
    updated_patient = request.json
    try:
        clinic_id = get_current_clinic_id()
        data = {
            'dni': sanitize(updated_patient.get('dni')),
            'nombre': sanitize(updated_patient.get('nombre')),
            'apellidos': sanitize(updated_patient.get('apellidos')),
            'fecha_nacimiento': sanitize(updated_patient.get('fechaNacimiento')),
            'genero': sanitize(updated_patient.get('genero')),
            'email': sanitize(updated_patient.get('email')),
            'telefono': sanitize(updated_patient.get('telefono')),
            'calle': sanitize(updated_patient.get('calle')),
            'numero_calle': sanitize(updated_patient.get('numero_calle')),
            'escalera': sanitize(updated_patient.get('escalera')),
            'piso': sanitize(updated_patient.get('piso')),
            'puerta': sanitize(updated_patient.get('puerta')),
            'municipio': sanitize(updated_patient.get('municipio')),
            'poblacion_provincia': sanitize(updated_patient.get('poblacion_provincia')),
            'cp': sanitize(updated_patient.get('cp')),
            'pais': sanitize(updated_patient.get('pais', 'España')),
            'alergias': sanitize(updated_patient.get('alergias')),
            'problemas_medicos': sanitize(updated_patient.get('problemasMedicos')),
            'medicamentos_actuales': sanitize(updated_patient.get('medicamentos')),
            'cirugias_previas': sanitize(updated_patient.get('cirugias')),
            'afeccion': sanitize(updated_patient.get('afeccion')),
            'notas_adicionales': sanitize(updated_patient.get('notas')),
            'emergencia_nombre': sanitize(updated_patient.get('emergenciaNombre')),
            'emergencia_telefono': sanitize(updated_patient.get('emergenciaTelefono')),
            'emergencia_relacion': sanitize(updated_patient.get('emergenciaRelacion'))
        }
        # Check for duplicates
        existing = supabase.table("pacientes").select("id").eq("id_clinica", clinic_id).eq("nombre", data['nombre']).eq("apellidos", data['apellidos']).execute()
        if existing.data and existing.data[0]['id'] != id:
            return jsonify({'status': 'error', 'message': 'Ya existe otro paciente con ese nombre y apellidos en esta clínica'}), 400

        supabase.table("pacientes").update(data).eq("id", id).eq("id_clinica", clinic_id).execute()
        return jsonify({'status': 'success'})
    except Exception as e:
        print(f"Error updating patient {id}: {e}")
        return jsonify({'status': 'error', 'message': str(e)}), 400

@app.route('/api/patients/<int:id>', methods=['DELETE'])
@token_required
def delete_patient(id):
    try:
        clinic_id = get_current_clinic_id()
        supabase.table("pacientes").delete().eq("id", id).eq("id_clinica", clinic_id).execute()
        return jsonify({'status': 'success'})
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 400

# Professionals
# Professionals
@app.route('/api/professionals', methods=['GET'])
@token_required
def get_professionals():
    try:
        clinic_id = get_current_clinic_id()
        res = supabase.table("profesionales").select("*").eq("id_clinica", clinic_id).execute()
        return jsonify(res.data)
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 400

@app.route('/api/professionals', methods=['POST'])
@token_required
def add_professional():
    data = request.json
    try:
        clinic_id = get_current_clinic_id()
        insert_data = {
            'id_clinica': clinic_id,
            'nombre': sanitize(data.get('nombre')),
            'especialidad': sanitize(data.get('especialidad')),
            'rol': sanitize(data.get('rol', 'dentista')),
            'sueldo': sanitize(data.get('sueldo')),
            'fecha_nacimiento': sanitize(data.get('fecha_nacimiento')),
            'telefono': sanitize(data.get('telefono')),
            'email': sanitize(data.get('email')),
            'calle': sanitize(data.get('calle')),
            'numero_calle': sanitize(data.get('numero_calle')),
            'cp': sanitize(data.get('cp')),
            'municipio': sanitize(data.get('municipio')),
            'poblacion_provincia': sanitize(data.get('poblacion_provincia')),
            'pais': sanitize(data.get('pais', 'España'))
        }
        # Check for duplicates
        existing = supabase.table("profesionales").select("id").eq("id_clinica", clinic_id).eq("nombre", insert_data['nombre']).execute()
        if existing.data:
            return jsonify({'status': 'error', 'message': 'Ya existe un profesional con ese nombre en esta clínica'}), 400

        supabase.table("profesionales").insert(insert_data).execute()
        return jsonify({'status': 'success'}), 201
    except Exception as e:
        print(f"Error adding professional: {e}")
        return jsonify({'status': 'error', 'message': str(e)}), 400

@app.route('/api/professionals/<int:id>', methods=['PUT'])
@token_required
def update_professional(id):
    data = request.json
    try:
        clinic_id = get_current_clinic_id()
        update_data = {
            'nombre': sanitize(data.get('nombre')),
            'especialidad': sanitize(data.get('especialidad')),
            'rol': sanitize(data.get('rol', 'dentista')),
            'sueldo': sanitize(data.get('sueldo')),
            'fecha_nacimiento': sanitize(data.get('fecha_nacimiento')),
            'telefono': sanitize(data.get('telefono')),
            'email': sanitize(data.get('email')),
            'calle': sanitize(data.get('calle')),
            'numero_calle': sanitize(data.get('numero_calle')),
            'cp': sanitize(data.get('cp')),
            'municipio': sanitize(data.get('municipio')),
            'poblacion_provincia': sanitize(data.get('poblacion_provincia')),
            'pais': sanitize(data.get('pais', 'España'))
        }
        # Check for duplicates
        existing = supabase.table("profesionales").select("id").eq("id_clinica", clinic_id).eq("nombre", update_data['nombre']).execute()
        if existing.data and existing.data[0]['id'] != id:
            return jsonify({'status': 'error', 'message': 'Ya existe otro profesional con ese nombre en esta clínica'}), 400

        supabase.table("profesionales").update(update_data).eq("id", id).eq("id_clinica", clinic_id).execute()
        return jsonify({'status': 'success'})
    except Exception as e:
        print(f"Error updating professional {id}: {e}")
        return jsonify({'status': 'error', 'message': str(e)}), 400

@app.route('/api/professionals/<int:id>', methods=['DELETE'])
@token_required
def delete_professional(id):
    try:
        clinic_id = get_current_clinic_id()
        supabase.table("profesionales").delete().eq("id", id).eq("id_clinica", clinic_id).execute()
        return jsonify({'status': 'success'})
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 400

# Treatments
# Treatments
@app.route('/api/treatments', methods=['GET'])
@token_required
def get_treatments():
    try:
        clinic_id = get_current_clinic_id()
        res = supabase.table("tratamientos").select("*").eq("id_clinica", clinic_id).execute()
        return jsonify(res.data)
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 400

@app.route('/api/treatments', methods=['POST'])
@token_required
def add_treatment():
    data = request.json
    try:
        clinic_id = get_current_clinic_id()
        insert_data = {
            'id_clinica': clinic_id,
            'nombre': data.get('nombre'),
            'descripcion': data.get('descripcion'),
            'duracion_estimada': sanitize(data.get('duracion_estimada')),
            'precio': sanitize(data.get('precio'))
        }
        # Check for duplicates
        existing = supabase.table("tratamientos").select("id").eq("id_clinica", clinic_id).eq("nombre", insert_data['nombre']).execute()
        if existing.data:
            return jsonify({'status': 'error', 'message': 'Ya existe un tratamiento con ese nombre en esta clínica'}), 400

        supabase.table("tratamientos").insert(insert_data).execute()
        return jsonify({'status': 'success'}), 201
    except Exception as e:
        print(f"Error adding treatment: {e}")
        return jsonify({'status': 'error', 'message': str(e)}), 400

@app.route('/api/treatments/<int:id>', methods=['PUT'])
@token_required
def update_treatment(id):
    data = request.json
    try:
        clinic_id = get_current_clinic_id()
        update_data = {
            'nombre': data.get('nombre'),
            'descripcion': data.get('descripcion'),
            'duracion_estimada': sanitize(data.get('duracion_estimada')),
            'precio': sanitize(data.get('precio'))
        }
        # Check for duplicates
        existing = supabase.table("tratamientos").select("id").eq("id_clinica", clinic_id).eq("nombre", update_data['nombre']).execute()
        if existing.data and existing.data[0]['id'] != id:
            return jsonify({'status': 'error', 'message': 'Ya existe otro tratamiento con ese nombre en esta clínica'}), 400

        supabase.table("tratamientos").update(update_data).eq("id", id).eq("id_clinica", clinic_id).execute()
        return jsonify({'status': 'success'})
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 400

@app.route('/api/treatments/<int:id>', methods=['DELETE'])
@token_required
def delete_treatment(id):
    try:
        clinic_id = get_current_clinic_id()
        supabase.table("tratamientos").delete().eq("id", id).eq("id_clinica", clinic_id).execute()
        return jsonify({'status': 'success'})
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 400

# Rooms
@app.route('/api/rooms', methods=['GET'])
@token_required
def get_rooms():
    try:
        clinic_id = get_current_clinic_id()
        res = supabase.table("salas").select("*").eq("id_clinica", clinic_id).execute()
        return jsonify(res.data)
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 400

@app.route('/api/rooms', methods=['POST'])
@token_required
def add_room():
    data = request.json
    try:
        clinic_id = get_current_clinic_id()
        insert_data = {
            'id_clinica': clinic_id,
            'nombre': data.get('nombre'),
            'descripcion': data.get('descripcion'),
            'color_asociado': data.get('color_asociado', '#3b82f6')
        }
        # Check for duplicates
        existing = supabase.table("salas").select("id").eq("id_clinica", clinic_id).eq("nombre", insert_data['nombre']).execute()
        if existing.data:
            return jsonify({'status': 'error', 'message': 'Ya existe una sala con ese nombre en esta clínica'}), 400

        supabase.table("salas").insert(insert_data).execute()
        return jsonify({'status': 'success'}), 201
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 400

@app.route('/api/rooms/<int:id>', methods=['PUT'])
@token_required
def update_room(id):
    data = request.json
    try:
        clinic_id = get_current_clinic_id()
        update_data = {
            'nombre': sanitize(data.get('nombre')),
            'descripcion': sanitize(data.get('descripcion')),
            'color_asociado': sanitize(data.get('color_asociado', '#3b82f6'))
        }
        # Check for duplicates
        existing = supabase.table("salas").select("id").eq("id_clinica", clinic_id).eq("nombre", update_data['nombre']).execute()
        if existing.data and existing.data[0]['id'] != id:
            return jsonify({'status': 'error', 'message': 'Ya existe otra sala con ese nombre en esta clínica'}), 400

        supabase.table("salas").update(update_data).eq("id", id).eq("id_clinica", clinic_id).execute()
        return jsonify({'status': 'success'})
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 400

@app.route('/api/rooms/<int:id>', methods=['DELETE'])
@token_required
def delete_room(id):
    try:
        clinic_id = get_current_clinic_id()
        supabase.table("salas").delete().eq("id", id).eq("id_clinica", clinic_id).execute()
        return jsonify({'status': 'success'})
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 400

# Appointments
@app.route('/api/appointments', methods=['GET'])
@token_required
def get_appointments():
    try:
        clinic_id = get_current_clinic_id()
        # Supabase select with explicit joins and hints
        select_query = "*, pacientes!id_paciente(nombre, apellidos), profesionales!id_profesional(nombre), tratamientos!id_tratamiento(nombre), salas!id_sala(nombre)"
        res = supabase.table("citas").select(select_query).eq("id_clinica", clinic_id).execute()
        
        # Format to match previous API structure
        appointments = []
        for row in res.data:
            appt = row.copy()
            # Safely access joined data to avoid AttributeError if join is missing
            patient = row.get('pacientes') or {}
            prof = row.get('profesionales') or {}
            treatment = row.get('tratamientos') or {}
            sala = row.get('salas') or {}
            
            appt['paciente_nombre'] = patient.get('nombre')
            appt['paciente_apellidos'] = patient.get('apellidos')
            appt['profesional_nombre'] = prof.get('nombre')
            appt['tratamiento_nombre'] = treatment.get('nombre')
            appt['sala_nombre'] = sala.get('nombre')
            appointments.append(appt)
            
        return jsonify(appointments)
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 400

@app.route('/api/appointments', methods=['POST'])
@token_required
def add_appointment():
    data = request.json
    try:
        clinic_id = get_current_clinic_id()
        insert_data = {
            'id_clinica': clinic_id,
            'id_paciente': sanitize(data.get('id_paciente')),
            'id_profesional': sanitize(data.get('id_profesional')),
            'id_tratamiento': sanitize(data.get('id_tratamiento')),
            'id_sala': sanitize(data.get('id_sala')),
            'fecha': sanitize(data.get('fecha')),
            'hora': sanitize(data.get('hora')),
            'duracion': sanitize(data.get('duracion')),
            'estado': sanitize(data.get('estado')),
            'cobrado': data.get('cobrado', False)
        }
        supabase.table("citas").insert(insert_data).execute()
        return jsonify({'status': 'success'}), 201
    except Exception as e:
        print(f"Error adding appointment: {e}")
        return jsonify({'status': 'error', 'message': str(e)}), 400

@app.route('/api/appointments/<int:id>', methods=['PUT'])
@token_required
def update_appointment(id):
    data = request.json
    try:
        clinic_id = get_current_clinic_id()
        update_data = {
            'id_paciente': sanitize(data.get('id_paciente')),
            'id_profesional': sanitize(data.get('id_profesional')),
            'id_tratamiento': sanitize(data.get('id_tratamiento')),
            'id_sala': sanitize(data.get('id_sala')),
            'fecha': sanitize(data.get('fecha')),
            'hora': sanitize(data.get('hora')),
            'duracion': sanitize(data.get('duracion')),
            'estado': sanitize(data.get('estado')),
            'cobrado': data.get('cobrado', False)
        }
        supabase.table("citas").update(update_data).eq("id", id).eq("id_clinica", clinic_id).execute()
        return jsonify({'status': 'success'})
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 400

@app.route('/api/appointments/<int:id>', methods=['DELETE'])
@token_required
def delete_appointment(id):
    try:
        clinic_id = get_current_clinic_id()
        supabase.table("citas").delete().eq("id", id).eq("id_clinica", clinic_id).execute()
        return jsonify({'status': 'success'})
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 400

@app.route('/api/appointments/<int:id>/status', methods=['PATCH'])
@token_required
def update_appointment_status(id):
    data = request.json
    try:
        clinic_id = get_current_clinic_id()
        supabase.table("citas").update({'estado': sanitize(data.get('estado'))}).eq("id", id).eq("id_clinica", clinic_id).execute()
        return jsonify({'status': 'success'})
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 400

@app.route('/api/appointments/<int:id>/cobrado', methods=['PATCH'])
@token_required
def update_appointment_cobrado(id):
    data = request.json
    is_cobrado = data.get('cobrado', False)
    try:
        clinic_id = get_current_clinic_id()
        supabase.table("citas").update({'cobrado': is_cobrado}).eq("id", id).eq("id_clinica", clinic_id).execute()
        
        # If marked as cobrado, automatically generate an invoice if it doesn't exist
        if is_cobrado:
            # Check if invoice already exists for this appt
            existing_inv = supabase.table("facturas").select("id").eq("id_cita", id).execute()
            if not existing_inv.data:
                # Fetch appt details to get patient and price
                # Use join to get treatment price
                appt_res = supabase.table("citas").select("*, tratamientos!id_tratamiento(precio)").eq("id", id).execute()
                if appt_res.data:
                    appt = appt_res.data[0]
                    total = float(appt.get('tratamientos', {}).get('precio', 0))
                    iva_percent = 0.0 # Default to 0% for automatic charging
                    base_imponible = total / (1 + iva_percent/100)
                    iva_importe = total - base_imponible
                    
                    # Generate invoice number based on count
                    count_res = supabase.table("facturas").select("id", count="exact").eq("id_clinica", clinic_id).execute()
                    current_count = count_res.count if count_res.count is not None else 0
                    inv_number = f"FAC-{clinic_id}-{current_count + 1:04d}"
                    
                    invoice_data = {
                        'id_clinica': clinic_id,
                        'id_cita': id,
                        'id_paciente': appt.get('id_paciente'),
                        'numero_factura': inv_number,
                        'fecha': date.today().isoformat(),
                        'total': total,
                        'base_imponible': round(base_imponible, 2),
                        'iva_percent': iva_percent,
                        'iva_importe': round(iva_importe, 2),
                        'estado': 'Pagada', # Since it was just "cobrado", we mark it as paid
                        'metodo_pago': 'Efectivo' # Default
                    }
                    supabase.table("facturas").insert(invoice_data).execute()
                    
        return jsonify({'status': 'success'})
    except Exception as e:
        print(f"Error updating cobrado status for appt {id}: {e}")
        return jsonify({'status': 'error', 'message': str(e)}), 400

# Users
@app.route('/api/users', methods=['GET'])
@token_required
@roles_allowed('super-admin', 'admin')
def get_users():
    try:
        clinic_id = get_current_clinic_id()
        res = supabase.table("usuarios").select("id, nombre_completo, username, rol, fecha_creacion").eq("id_clinica", clinic_id).execute()
        return jsonify(res.data)
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 400

@app.route('/api/users', methods=['POST'])
@token_required
@roles_allowed('super-admin', 'admin')
def add_user():
    data = request.json
    try:
        clinic_id = get_current_clinic_id()
        hashed_password = generate_password_hash(data.get('password'))
        insert_data = {
            'id_clinica': clinic_id,
            'nombre_completo': data.get('nombre_completo'),
            'username': data.get('username'),
            'password': hashed_password,
            'rol': data.get('rol')
        }
        supabase.table("usuarios").insert(insert_data).execute()
        return jsonify({'status': 'success'}), 201
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 400

@app.route('/api/users/<int:id>', methods=['PUT'])
@token_required
@roles_allowed('super-admin', 'admin')
def update_user(id):
    data = request.json
    try:
        clinic_id = get_current_clinic_id()
        update_data = {}
        if data.get('nombre_completo'):
            update_data['nombre_completo'] = data.get('nombre_completo')
        if data.get('username'):
            update_data['username'] = data.get('username')
        if data.get('rol'):
            update_data['rol'] = data.get('rol')
        if data.get('password'):
            update_data['password'] = generate_password_hash(data.get('password'))
            
        if not update_data:
            return jsonify({'status': 'error', 'message': 'No data to update'}), 400
            
        supabase.table("usuarios").update(update_data).eq("id", id).eq("id_clinica", clinic_id).execute()
        return jsonify({'status': 'success'})
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 400

@app.route('/api/users/<int:id>', methods=['DELETE'])
@token_required
@roles_allowed('super-admin', 'admin')
def delete_user(id):
    try:
        clinic_id = get_current_clinic_id()
        supabase.table("usuarios").delete().eq("id", id).eq("id_clinica", clinic_id).execute()
        return jsonify({'status': 'success'})
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 400

@app.route('/api/login', methods=['POST'])
def login():
    data = request.json
    try:
        clinic_id = get_current_clinic_id()
        res = supabase.table("usuarios").select("*").eq("username", data.get('username')).execute()
        
        if res.data:
            user = res.data[0]
            if check_password_hash(user['password'], data.get('password')):
                user_dict = user.copy()
                del user_dict['password']
                # Generate JWT token on successful login
                from datetime import timedelta
                token_payload = {
                    'id': user['id'],
                    'username': user['username'],
                    'rol': user.get('rol'),
                    'id_clinica': user.get('id_clinica'),
                    'exp': datetime.utcnow() + timedelta(hours=24)
                }
                token = jwt.encode(token_payload, app.config['JWT_SECRET_KEY'], algorithm='HS256')
                return jsonify({'status': 'success', 'user': user_dict, 'token': token})
        
        return jsonify({'status': 'error', 'message': 'Usuario o contraseña incorrectos'}), 401
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 400

# Admin / Clinics management
@app.route('/api/admin/clinics', methods=['GET'])
@token_required
@roles_allowed('super-admin')
def get_all_clinics():
    try:
        res = supabase.table("clinicas").select("*").execute()
        return jsonify(res.data)
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 400

@app.route('/api/admin/clinics', methods=['POST'])
@token_required
@roles_allowed('super-admin')
def add_clinic():
    data = request.json
    try:
        nombre = data.get('nombre')
        if not nombre:
             return jsonify({'status': 'error', 'message': 'Nombre es requerido'}), 400
             
        # Generate a unique DB name for the new clinic (kept for compatibility, though Supabase uses id_clinica)
        safe_name = "".join([c for c in nombre if c.isalpha() or c.isdigit() or c==' ']).rstrip().replace(" ", "_").lower()
        import time
        db_name = f"dentia_{safe_name}_{int(time.time())}.db"
        
        insert_data = {
            'nombre': nombre,
            'direccion': data.get('direccion'),
            'telefono': data.get('telefono'),
            'email': data.get('email'),
            'cif': data.get('cif'),
            'web': data.get('web'),
            'db_name': db_name
        }
        
        res = supabase.table("clinicas").insert(insert_data).execute()
        return jsonify({'status': 'success', 'data': res.data[0]}), 201
            
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 400

@app.route('/api/inventory', methods=['GET'])
@token_required
def get_inventory():
    try:
        clinic_id = get_current_clinic_id()
        res = supabase.table("inventario").select("*").eq("id_clinica", clinic_id).execute()
        return jsonify(res.data)
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 400

@app.route('/api/inventory', methods=['POST'])
@token_required
def add_inventory():
    data = request.json
    fecha_compra = sanitize(data.get('fecha_de_compra'))
    if not fecha_compra:
        fecha_compra = date.today().isoformat()
        
    try:
        clinic_id = get_current_clinic_id()
        insert_data = {
            'id_clinica': clinic_id,
            'nombre_producto': data.get('nombre_producto'),
            'marca': data.get('marca'),
            'cantidad': sanitize(data.get('cantidad')),
            'unidades': data.get('unidades'),
            'categoria': data.get('categoria'),
            'nivel_de_reposicion': sanitize(data.get('nivel_de_reposicion')),
            'lote': data.get('lote'),
            'fecha_de_compra': fecha_compra,
            'fecha_de_caducidad': sanitize(data.get('fecha_de_caducidad')),
            'coste': sanitize(data.get('coste')),
            'precio_de_venta': sanitize(data.get('precio_de_venta')),
            'notas_adicionales': data.get('notas_adicionales')
        }
        supabase.table("inventario").insert(insert_data).execute()
        return jsonify({'status': 'success'}), 201
    except Exception as e:
        print(f"Error adding inventory: {e}")
        return jsonify({'status': 'error', 'message': str(e)}), 400

@app.route('/api/inventory/<int:id>', methods=['PUT'])
@token_required
def update_inventory(id):
    data = request.json
    try:
        clinic_id = get_current_clinic_id()
        update_data = {
            'nombre_producto': data.get('nombre_producto'),
            'marca': data.get('marca'),
            'cantidad': sanitize(data.get('cantidad')),
            'unidades': data.get('unidades'),
            'categoria': data.get('categoria'),
            'nivel_de_reposicion': sanitize(data.get('nivel_de_reposicion')),
            'lote': data.get('lote'),
            'fecha_de_compra': sanitize(data.get('fecha_de_compra')),
            'fecha_de_caducidad': sanitize(data.get('fecha_de_caducidad')),
            'coste': sanitize(data.get('coste')),
            'precio_de_venta': sanitize(data.get('precio_de_venta')),
            'notas_adicionales': data.get('notas_adicionales')
        }
        supabase.table("inventario").update(update_data).eq("id", id).eq("id_clinica", clinic_id).execute()
        return jsonify({'status': 'success'})
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 400

@app.route('/api/inventory/<int:id>', methods=['DELETE'])
@token_required
def delete_inventory(id):
    try:
        clinic_id = get_current_clinic_id()
        supabase.table("inventario").delete().eq("id", id).eq("id_clinica", clinic_id).execute()
        return jsonify({'status': 'success'})
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 400

@app.route('/api/inventory/<int:id>/adjust', methods=['POST'])
@token_required
def adjust_inventory_stock(id):
    data = request.json
    try:
        clinic_id = get_current_clinic_id()
        adjustment = int(data.get('adjustment', 0))
        
        # Get current quantity
        res = supabase.table("inventario").select("cantidad").eq("id", id).eq("id_clinica", clinic_id).execute()
        
        if not res.data:
            return jsonify({'status': 'error', 'message': 'Producto no encontrado'}), 404
        
        current_stock = res.data[0]['cantidad'] or 0
        new_stock = current_stock + adjustment
        
        supabase.table("inventario").update({'cantidad': new_stock}).eq("id", id).eq("id_clinica", clinic_id).execute()
        return jsonify({'status': 'success', 'new_stock': new_stock})
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 400

# Consent
@app.route('/api/consent', methods=['GET'])
@token_required
def get_consent_documents():
    try:
        clinic_id = get_current_clinic_id()
        res = supabase.table("documentos_consentimiento").select("*").eq("id_clinica", clinic_id).order("fecha_subida", desc=True).execute()
        return jsonify(res.data)
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 400

@app.route('/api/consent', methods=['POST'])
@token_required
def upload_consent_document():
    if 'archivo' not in request.files:
        return jsonify({'status': 'error', 'message': 'No se encontró el archivo'}), 400
    
    archivo = request.files['archivo']
    titulo = request.form.get('titulo')
    descripcion = request.form.get('descripcion')
    
    if archivo.filename == '':
        return jsonify({'status': 'error', 'message': 'Nombre de archivo vacío'}), 400
    
    if archivo and archivo.filename.endswith('.pdf'):
        from werkzeug.utils import secure_filename
        filename = secure_filename(archivo.filename)
        # Magic number check for PDF
        archivo_stream = archivo.stream.read(4)
        archivo.stream.seek(0)
        if archivo_stream != b'%PDF':
            return jsonify({'status': 'error', 'message': 'Only PDF files are allowed'}), 400
        # Continue with safe filename handling as before
        from werkzeug.utils import secure_filename
        filename = secure_filename(archivo.filename)
        # Ensure unique filename
        base, extension = os.path.splitext(filename)
        counter = 1
        while os.path.exists(os.path.join(UPLOAD_FOLDER, filename)):
            filename = f"{base}_{counter}{extension}"
            counter += 1
        
        archivo_path = os.path.join(UPLOAD_FOLDER, filename)
        archivo.save(archivo_path)
        
        try:
            clinic_id = get_current_clinic_id()
            insert_data = {
                'id_clinica': clinic_id,
                'titulo': titulo,
                'descripcion': descripcion,
                'archivo_path': filename
            }
            supabase.table("documentos_consentimiento").insert(insert_data).execute()
            return jsonify({'status': 'success', 'filename': filename}), 201
        except Exception as e:
            return jsonify({'status': 'error', 'message': str(e)}), 400
    
    return jsonify({'status': 'error', 'message': 'Formato de archivo no permitido (solo PDF)'}), 400

@app.route('/api/consent/<int:id>', methods=['DELETE'])
@token_required
def delete_consent_document(id):
    try:
        clinic_id = get_current_clinic_id()
        res = supabase.table("documentos_consentimiento").select("archivo_path").eq("id", id).eq("id_clinica", clinic_id).execute()
        
        if res.data:
            filename = res.data[0]['archivo_path']
            file_path = os.path.join(UPLOAD_FOLDER, filename)
            if os.path.exists(file_path):
                os.remove(file_path)
            supabase.table("documentos_consentimiento").delete().eq("id", id).eq("id_clinica", clinic_id).execute()
            return jsonify({'status': 'success'})
        return jsonify({'status': 'error', 'message': 'Documento no encontrado'}), 404
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 400

# Billing & Invoicing
@app.route('/api/billing/dashboard', methods=['GET'])
@token_required
def get_billing_dashboard():
    try:
        clinic_id = get_current_clinic_id()
        current_year = date.today().year
        # Fetch all paid invoices for the current year
        res = supabase.table("facturas").select("total, fecha").eq("id_clinica", clinic_id).eq("estado", "Pagada").gte("fecha", f"{current_year}-01-01").execute()
        
        invoices = res.data or []
        
        today = date.today()
        # Start of week (Monday)
        start_of_week = today - timedelta(days=today.weekday())
        # Start of month
        start_of_month = today.replace(day=1)
        
        diaria_sum = 0.0
        semanal_sum = 0.0
        mensual_sum = 0.0
        anual_sum = 0.0
        
        today_str = today.isoformat()
        start_of_week_str = start_of_week.isoformat()
        start_of_month_str = start_of_month.isoformat()
        
        for inv in invoices:
            inv_date_str = inv['fecha']
            inv_total = float(inv['total'] or 0)
            
            if inv_date_str == today_str:
                diaria_sum += inv_total
            if inv_date_str >= start_of_week_str:
                semanal_sum += inv_total
            if inv_date_str >= start_of_month_str:
                mensual_sum += inv_total
            anual_sum += inv_total
            
        return jsonify({
            'status': 'success',
            'data': {
                'diaria': f"{diaria_sum:.2f} €",
                'semanal': f"{semanal_sum:.2f} €",
                'mensual': f"{mensual_sum:.2f} €",
                'anual': f"{anual_sum:.2f} €"
            }
        })
    except Exception as e:
        print(f"Error calculating dashboard billing: {e}")
        return jsonify({
            'status': 'success',
            'data': {
                'diaria': '0.00 €',
                'semanal': '0.00 €',
                'mensual': '0.00 €',
                'anual': '0.00 €'
            }
        })

@app.route('/api/billing/stats', methods=['GET'])
@token_required
def get_billing_stats():
    try:
        clinic_id = get_current_clinic_id()
        today = date.today().isoformat()
        this_month = today[:7] # YYYY-MM
        
        # 1. Por Facturar (Completed appointments not in facturas)
        # For simplicity in this logic, we'll fetch completed appointments and then filter
        # In a real app, a subquery or join would be better
        appts_res = supabase.table("citas").select("id, personas:id_tratamiento(precio)").eq("id_clinica", clinic_id).eq("estado", "Completada").eq("cobrado", False).execute()
        
        por_facturar_list = appts_res.data
        por_facturar_count = len(por_facturar_list)
        por_facturar_amount = sum([float(a.get('personas', {}).get('precio') or 0) for a in por_facturar_list])
        
        # 2. Pendiente de Cobro
        pendiente_res = supabase.table("facturas").select("total").eq("id_clinica", clinic_id).eq("estado", "Emitida").execute()
        pendiente_count = len(pendiente_res.data)
        pendiente_amount = sum([float(f['total'] or 0) for f in pendiente_res.data])
        
        # 3. Cobrado Hoy
        cobrado_hoy_res = supabase.table("facturas").select("total").eq("id_clinica", clinic_id).eq("estado", "Pagada").eq("fecha", today).execute()
        cobrado_hoy_count = len(cobrado_hoy_res.data)
        cobrado_hoy_amount = sum([float(f['total'] or 0) for f in cobrado_hoy_res.data])
        
        # 4. Facturado este Mes
        facturado_mes_res = supabase.table("facturas").select("total").eq("id_clinica", clinic_id).eq("estado", "Pagada").gte("fecha", f"{this_month}-01").execute()
        facturado_mes_count = len(facturado_mes_res.data)
        facturado_mes_amount = sum([float(f['total'] or 0) for f in facturado_mes_res.data])
        
        return jsonify({
            'porFacturar': {'amount': por_facturar_amount, 'count': por_facturar_count},
            'pendienteCobro': {'amount': pendiente_amount, 'count': pendiente_count},
            'cobradoHoy': {'amount': cobrado_hoy_amount, 'count': cobrado_hoy_count},
            'facturadoMes': {'amount': facturado_mes_amount, 'count': facturado_mes_count}
        })
    except Exception as e:
        print(f"Error getting billing stats: {e}")
        # If facturas table doesn't exist yet, return zeros but handle error gracefully
        return jsonify({
            'porFacturar': {'amount': 0, 'count': 0},
            'pendienteCobro': {'amount': 0, 'count': 0},
            'cobradoHoy': {'amount': 0, 'count': 0},
            'facturadoMes': {'amount': 0, 'count': 0},
            'warning': 'Facturas table might be missing'
        })

@app.route('/api/appointments/unbilled', methods=['GET'])
@token_required
def get_unbilled_appointments():
    try:
        clinic_id = get_current_clinic_id()
        # Fetch completed appts with patient and treatment info
        select_query = "*, pacientes!id_paciente(nombre, apellidos), tratamientos!id_tratamiento(nombre, precio)"
        res = supabase.table("citas").select(select_query).eq("id_clinica", clinic_id).eq("estado", "Completada").eq("cobrado", False).execute()
        
        unbilled = []
        for row in res.data:
            item = row.copy()
            item['paciente_nombre_completo'] = f"{row.get('pacientes',{}).get('nombre','')} {row.get('pacientes',{}).get('apellidos','')}"
            item['tratamiento_nombre'] = row.get('tratamientos',{}).get('nombre','')
            item['precio'] = row.get('tratamientos',{}).get('precio', 0)
            unbilled.append(item)
                
        return jsonify(unbilled)
    except Exception as e:
        return jsonify([])

@app.route('/api/invoices', methods=['GET'])
@token_required
def get_invoices():
    try:
        clinic_id = get_current_clinic_id()
        res = supabase.table("facturas").select("*, pacientes!id_paciente(nombre, apellidos)").eq("id_clinica", clinic_id).order("fecha", desc=True).execute()
        
        invoices = []
        for row in res.data:
            inv = row.copy()
            inv['paciente_nombre_completo'] = f"{row.get('pacientes',{}).get('nombre','')} {row.get('pacientes',{}).get('apellidos','')}"
            invoices.append(inv)
            
        return jsonify(invoices)
    except Exception as e:
        return jsonify([])

@app.route('/api/invoices', methods=['POST'])
@token_required
def create_invoice():
    data = request.json
    try:
        clinic_id = get_current_clinic_id()
        
        # Format: id_cita, id_paciente, total, metodo_pago
        # Generate invoice number based on count
        count_res = supabase.table("facturas").select("id", count="exact").eq("id_clinica", clinic_id).execute()
        current_count = count_res.count if count_res.count is not None else 0
        inv_number = f"FAC-{clinic_id}-{current_count + 1:04d}"
        
        total = float(data.get('total', 0))
        iva_percent = float(data.get('iva_percent', 0))
        base_imponible = total / (1 + iva_percent/100)
        iva_importe = total - base_imponible

        insert_data = {
            'id_clinica': clinic_id,
            'id_cita': data.get('id_cita'),
            'id_paciente': data.get('id_paciente'),
            'numero_factura': inv_number,
            'fecha': date.today().isoformat(),
            'total': total,
            'base_imponible': round(base_imponible, 2),
            'iva_percent': iva_percent,
            'iva_importe': round(iva_importe, 2),
            'estado': 'Emitida',
            'metodo_pago': data.get('metodo_pago', 'Efectivo'),
            'notas': data.get('notas', '')
        }
        
        res = supabase.table("facturas").insert(insert_data).execute()
        
        # Mark appointment as cobrado so it disappears from unbilled list
        if data.get('id_cita'):
            supabase.table("citas").update({'cobrado': True}).eq("id", data.get('id_cita')).execute()
            
        return jsonify({'status': 'success', 'data': res.data[0]}), 201
    except Exception as e:
        print(f"Error creating invoice: {e}")
        return jsonify({'status': 'error', 'message': str(e)}), 400

@app.route('/api/invoices/<int:id>/pay', methods=['PATCH'])
@token_required
def mark_invoice_as_paid(id):
    try:
        clinic_id = get_current_clinic_id()
        supabase.table("facturas").update({'estado': 'Pagada'}).eq("id", id).eq("id_clinica", clinic_id).execute()
        return jsonify({'status': 'success'})
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 400

@app.route('/api/invoices/<int:id>/cancel', methods=['PATCH'])
@token_required
def cancel_invoice(id):
    try:
        clinic_id = get_current_clinic_id()
        # Fetch invoice to see if it has an associated appt
        inv_res = supabase.table("facturas").select("id_cita").eq("id", id).eq("id_clinica", clinic_id).execute()
        if inv_res.data:
            id_cita = inv_res.data[0].get('id_cita')
            if id_cita:
                # If we cancel the invoice, we mark the appt as unbilled again
                supabase.table("citas").update({'cobrado': False}).eq("id", id_cita).execute()
        
        supabase.table("facturas").update({'estado': 'Anulada'}).eq("id", id).eq("id_clinica", clinic_id).execute()
        return jsonify({'status': 'success'})
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 400

@app.route('/api/invoices/<int:id>', methods=['GET'])
@token_required
def get_invoice_details(id):
    try:
        clinic_id = get_current_clinic_id()
        
        # Fetch invoice
        inv_res = supabase.table("facturas").select("*").eq("id", id).eq("id_clinica", clinic_id).execute()
        if not inv_res.data:
            return jsonify({'status': 'error', 'message': 'Factura no encontrada'}), 404
        invoice = inv_res.data[0]
        
        # Fetch patient
        patient_res = supabase.table("pacientes").select("*").eq("id", invoice.get("id_paciente")).execute()
        patient = patient_res.data[0] if patient_res.data else {}
        
        # Fetch clinic
        clinic_res = supabase.table("clinicas").select("*").eq("id", clinic_id).execute()
        clinic = clinic_res.data[0] if clinic_res.data else {}
        
        # Fetch appointment and treatment
        appt = {}
        treatment = {}
        if invoice.get("id_cita"):
            appt_res = supabase.table("citas").select("*").eq("id", invoice.get("id_cita")).execute()
            if appt_res.data:
                appt = appt_res.data[0]
                if appt.get("id_tratamiento"):
                    treat_res = supabase.table("tratamientos").select("*").eq("id", appt.get("id_tratamiento")).execute()
                    if treat_res.data:
                        treatment = treat_res.data[0]
                        
        return jsonify({
            'status': 'success',
            'invoice': invoice,
            'patient': patient,
            'clinic': clinic,
            'appointment': appt,
            'treatment': treatment
        })
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 400

# --- PRESUPUESTOS ---
@app.route('/api/presupuestos', methods=['GET'])
@token_required
def get_presupuestos():
    try:
        clinic_id = get_current_clinic_id()
        res = supabase.table("presupuestos").select("*").eq("id_clinica", clinic_id).order('fecha', desc=True).execute()
        
        # Manual join for pacientes
        for p in res.data:
            patient_id = p.get('id_paciente')
            if patient_id:
                patient_res = supabase.table("pacientes").select("nombre, apellidos").eq("id", patient_id).execute()
                if patient_res.data:
                    p['pacientes'] = patient_res.data[0]
                    p['paciente_nombre_completo'] = f"{p['pacientes'].get('nombre', '')} {p['pacientes'].get('apellidos', '')}".strip()
                else:
                    p['pacientes'] = None
                    p['paciente_nombre_completo'] = "Paciente Desconocido"
            else:
                p['pacientes'] = None
                p['paciente_nombre_completo'] = "Paciente Desconocido"
        
        return jsonify(res.data)
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 400

@app.route('/api/presupuestos/<int:id>', methods=['GET'])
@token_required
def get_presupuesto_details(id):
    try:
        clinic_id = get_current_clinic_id()
        # Get header
        res = supabase.table("presupuestos").select("*").eq("id", id).eq("id_clinica", clinic_id).execute()
        if not res.data:
            return jsonify({'status': 'error', 'message': 'Presupuesto no encontrado'}), 404
        
        budget = res.data[0]
        
        # Manual fetch for patient
        patient_id = budget.get('id_paciente')
        if patient_id:
            patient_res = supabase.table("pacientes").select("*").eq("id", patient_id).execute()
            if patient_res.data:
                budget['pacientes'] = patient_res.data[0]
                budget['paciente_nombre_completo'] = f"{budget['pacientes'].get('nombre', '')} {budget['pacientes'].get('apellidos', '')}".strip()
            else:
                budget['pacientes'] = None
                budget['paciente_nombre_completo'] = "Paciente Desconocido"
        else:
            budget['pacientes'] = None
            budget['paciente_nombre_completo'] = "Paciente Desconocido"

        # Get items
        items_res = supabase.table("presupuesto_items").select("*").eq("id_presupuesto", id).execute()
        items = items_res.data or []
        
        # Obtener los IDs de tratamientos únicos para evitar consultas redundantes
        treatment_ids = list(set(item['id_tratamiento'] for item in items if item.get('id_tratamiento')))
        treatments_by_id = {}
        if treatment_ids:
            treatments_res = supabase.table("tratamientos").select("*").in_("id", treatment_ids).execute()
            for t in (treatments_res.data or []):
                treatments_by_id[t['id']] = t
                
        # Asociar los detalles del tratamiento a cada ítem en el formato esperado por el frontend
        for item in items:
            tid = item.get('id_tratamiento')
            item['tratamientos'] = treatments_by_id.get(tid)
            
        budget['items'] = items
        
        return jsonify(budget)
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 400

@app.route('/api/presupuestos', methods=['POST'])
@token_required
def create_presupuesto():
    try:
        clinic_id = get_current_clinic_id()
        data = request.json
        
        # 1. Generate budget number
        count_res = supabase.table("presupuestos").select("id", count="exact").eq("id_clinica", clinic_id).execute()
        current_count = count_res.count if count_res.count is not None else 0
        budget_number = f"PRE-{clinic_id}-{current_count + 1:04d}"
        
        # 2. Insert header
        header_data = {
            'id_clinica': clinic_id,
            'id_paciente': data.get('id_paciente'),
            'numero_presupuesto': budget_number,
            'fecha': date.today().isoformat(),
            'total': data.get('total', 0),
            'estado': 'Borrador',
            'notas': data.get('notas', '')
        }
        res_header = supabase.table("presupuestos").insert(header_data).execute()
        budget_id = res_header.data[0]['id']
        
        # 3. Insert items
        items = data.get('items', [])
        for item in items:
            item_data = {
                'id_presupuesto': budget_id,
                'id_tratamiento': item.get('id_tratamiento'),
                'cantidad': item.get('cantidad', 1),
                'precio_unitario': item.get('precio_unitario'),
                'descuento_percent': item.get('descuento_percent', 0),
                'total': item.get('total')
            }
            supabase.table("presupuesto_items").insert(item_data).execute()
            
        return jsonify({'status': 'success', 'id': budget_id})
    except Exception as e:
        print(f"Error creating budget: {e}")
        return jsonify({'status': 'error', 'message': str(e)}), 400

@app.route('/api/presupuestos/<int:id>/status', methods=['PATCH'])
@token_required
def update_presupuesto_status(id):
    try:
        clinic_id = get_current_clinic_id()
        data = request.json
        supabase.table("presupuestos").update({'estado': data.get('estado')}).eq("id", id).eq("id_clinica", clinic_id).execute()
        return jsonify({'status': 'success'})
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 400

@app.route('/api/presupuestos/<int:id>', methods=['DELETE'])
@token_required
def delete_presupuesto(id):
    try:
        clinic_id = get_current_clinic_id()
        supabase.table("presupuestos").delete().eq("id", id).eq("id_clinica", clinic_id).execute()
        return jsonify({'status': 'success'})
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 400

# Clinic Info
@app.route('/api/clinic', methods=['GET'])
@token_required
def get_clinic():
    try:
        clinic_id = get_current_clinic_id()
        res = supabase.table("clinicas").select("*").eq("id", clinic_id).execute()
        return jsonify(res.data[0] if res.data else {})
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 400

@app.route('/api/clinic', methods=['PUT'])
@token_required
def update_clinic():
    data = request.json
    try:
        clinic_id = get_current_clinic_id()
        update_data = {
            'nombre': data.get('nombre'),
            'direccion': data.get('direccion'),
            'telefono': data.get('telefono'),
            'email': data.get('email'),
            'cif': data.get('cif'),
            'web': data.get('web')
        }
        supabase.table("clinicas").update(update_data).eq("id", clinic_id).execute()
        return jsonify({'status': 'success', 'message': 'Información de la clínica actualizada'})
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 400

# AI Simulation
@app.route('/api/simulate', methods=['POST'])
@token_required
def simulate_treatment():
    data = request.json
    image_data = data.get('image') # Base64 string
    treatment = data.get('treatment', 'whitening') # whitening, alignment, veneers, implants
    
    if not image_data:
        return jsonify({'status': 'error', 'message': 'No se proporcionó ninguna imagen'}), 400

    api_key = os.getenv('OPENAI_API_KEY')
    if not api_key:
        return jsonify({'status': 'error', 'message': 'API Key no configurada'}), 500

    # Map treatments to prompts
    prompts = {
        'whitening': "A professional dental simulation showing the patient with perfectly white and bright teeth. Realistic high-quality dental photography.",
        'alignment': "A professional dental simulation showing the patient with perfectly straight teeth after orthodontic treatment. Realistic high-quality dental photography.",
        'veneers': "A professional dental simulation showing the patient with beautiful porcelain veneers, perfect shape and color. Realistic high-quality dental photography.",
        'implants': "A professional dental simulation filling dental gaps with realistic implants. Realistic high-quality dental photography."
    }
    
    prompt = prompts.get(treatment, prompts['whitening'])
    
    try:
        # OpenAI Image Edit or Generation
        # Note: DALL-E 3 doesn't support 'Edit' via API as DALL-E 2 did, 
        # but for simplicity and demo purposes, we will use 'Generations' with a descriptive prompt
        # OR better: use DALL-E 2 Edits if we have a mask, but here let's try high-quality descriptive generation
        
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}"
        }
        
        # Using DALL-E 3 for best quality (Generation based on prompt + original description)
        payload = {
            "model": "dall-e-3",
            "prompt": f"{prompt} Based on a dental photo, provide a realistic AFTER result.",
            "n": 1,
            "size": "1024x1024",
            "response_format": "url"
        }
        
        response = requests.post("https://api.openai.com/v1/images/generations", headers=headers, json=payload)
        result = response.json()
        
        if 'error' in result:
            return jsonify({'status': 'error', 'message': result['error']['message']}), 500
            
        image_url = result['data'][0]['url']
        return jsonify({'status': 'success', 'image_url': image_url})
        
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 400

# Schedule
@app.route('/api/schedule', methods=['GET'])
@token_required
def get_schedule():
    try:
        clinic_id = get_current_clinic_id()
        res = supabase.table("horarios").select("*").eq("id_clinica", clinic_id).execute()
        return jsonify(res.data)
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 400

@app.route('/api/schedule', methods=['POST'])
@token_required
def save_schedule():
    data = request.json # List of day objects
    try:
        clinic_id = get_current_clinic_id()
        for day in data:
            upsert_data = {
                'id_clinica': clinic_id,
                'dia_semana': day['dia_semana'],
                'abierto': day['abierto'],
                'hora_apertura': day['hora_apertura'],
                'hora_cierre': day['hora_cierre']
            }
            supabase.table("horarios").upsert(upsert_data, on_conflict="id_clinica, dia_semana").execute()
            
        return jsonify({'status': 'success', 'message': 'Horarios guardados correctamente'})
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 400

# Generic Configuration Endpoints
@app.route('/api/config/<string:clave>', methods=['GET'])
@token_required
def get_config_value(clave):
    try:
        clinic_id = get_current_clinic_id()
        res = supabase.table("configuracion").select("valor").eq("id_clinica", clinic_id).eq("clave", clave).execute()
        if res.data:
            val = res.data[0]['valor']
            if isinstance(val, str):
                try:
                    val = json.loads(val)
                except:
                    pass
            return jsonify({'status': 'success', 'data': val})
        return jsonify({'status': 'success', 'data': None})
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 400

@app.route('/api/config/<string:clave>', methods=['POST'])
@token_required
def save_config_value(clave):
    try:
        clinic_id = get_current_clinic_id()
        data = request.json
        
        upsert_data = {
            'id_clinica': clinic_id,
            'clave': clave,
            'valor': data.get('valor'),
            'fecha_modificacion': datetime.utcnow().isoformat()
        }
        
        supabase.table("configuracion").upsert(upsert_data, on_conflict="id_clinica,clave").execute()
        return jsonify({'status': 'success'})
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 400

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)
