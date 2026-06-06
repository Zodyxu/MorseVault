import sqlite3
import os
import hashlib
import re
from datetime import datetime, date
from flask import (Flask, render_template, request, redirect,
                   url_for, g, jsonify, session)
from flask_mail import Mail, Message
from morse_logic import translate_morse
import account as acct

app = Flask(__name__)
app.secret_key = os.environ.get('SESSION_SECRET', 'morsevault-dev-key-change-in-prod')
DATABASE = os.path.join(os.path.dirname(__file__), 'database.db')

# ─── SMTP / Flask-Mail ───────────────────────────────────────────────────────────
SMTP_HOST = os.environ.get('SMTP_HOST', '')
SMTP_PORT = int(os.environ.get('SMTP_PORT', 587))
SMTP_USER = os.environ.get('SMTP_USER', '')
SMTP_PASS = os.environ.get('SMTP_PASS', '')
SMTP_FROM = os.environ.get('SMTP_FROM', SMTP_USER)

app.config['MAIL_SERVER'] = SMTP_HOST
app.config['MAIL_PORT'] = SMTP_PORT
app.config['MAIL_USE_TLS'] = True
app.config['MAIL_USERNAME'] = SMTP_USER
app.config['MAIL_PASSWORD'] = SMTP_PASS
app.config['MAIL_DEFAULT_SENDER'] = SMTP_FROM or SMTP_USER
mail = Mail(app)

VALID_KEYBOARD_MODES = ('alphabet', 'morse')
VALID_SETTINGS_SECTIONS = (
    'account', 'default-passcode', 'security-question',
    'translation-timer', 'auto-lock-timer', 'appearance', 'keyboard-mode',
)

# ─── Jinja filter ────────────────────────────────────────────────────────────────

@app.template_filter('fmtdate')
def format_date(value):
    if not value:
        return 'Unknown date'
    try:
        dt = datetime.strptime(str(value)[:19], '%Y-%m-%d %H:%M:%S')
        today = date.today()
        delta = (today - dt.date()).days
        if delta == 0:
            return 'Today'
        elif delta == 1:
            return 'Yesterday'
        elif 2 <= delta <= 6:
            return f'{delta} days ago'
        else:
            return dt.strftime('%b %-d, %Y')
    except Exception:
        return str(value)[:10]

# ─── Database helpers ─────────────────────────────────────────────────────────────

def get_db():
    db = getattr(g, '_database', None)
    if db is None:
        db = g._database = sqlite3.connect(DATABASE)
        db.row_factory = sqlite3.Row
    return db

@app.teardown_appcontext
def close_connection(exception):
    db = getattr(g, '_database', None)
    if db is not None:
        db.close()

def init_db():
    with app.app_context():
        db = get_db()
        db.execute('''
            CREATE TABLE IF NOT EXISTS folders (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                parent_id INTEGER REFERENCES folders(id),
                user_id INTEGER,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        db.execute('''
            CREATE TABLE IF NOT EXISTS notes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                morse_text TEXT NOT NULL,
                passcode_hash TEXT,
                use_custom_passcode INTEGER DEFAULT 0,
                folder_id INTEGER REFERENCES folders(id),
                user_id INTEGER,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        db.execute('''
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT
            )
        ''')
        db.execute('''
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                recovery_email TEXT,
                security_question TEXT,
                security_answer_hash TEXT,
                default_passcode_hash TEXT,
                translation_timer TEXT DEFAULT '30',
                auto_lock_timer TEXT DEFAULT 'never',
                keyboard_mode TEXT DEFAULT 'alphabet',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        for table, col in [('notes', 'user_id INTEGER'), ('folders', 'user_id INTEGER')]:
            try:
                db.execute(f'ALTER TABLE {table} ADD COLUMN {col}')
            except Exception:
                pass
        for col in [
            'passcode_hash TEXT',
            'use_custom_passcode INTEGER DEFAULT 0',
            'folder_id INTEGER',
        ]:
            try:
                db.execute(f'ALTER TABLE notes ADD COLUMN {col}')
            except Exception:
                pass
        db.commit()

# ─── Settings helpers ─────────────────────────────────────────────────────────────

def get_setting(key, default=None):
    return acct.get_user_pref(key, default)

def set_setting(key, value):
    acct.set_user_pref(key, value)

# ─── Security helpers ─────────────────────────────────────────────────────────────

def hash_value(value: str) -> str:
    return hashlib.sha256(value.encode('utf-8')).hexdigest()

def sanitize(value: str, max_len: int = 500) -> str:
    value = value.strip()
    value = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]', '', value)
    return value[:max_len]

VALID_MORSE_RE = re.compile(r'^[.\-/\s]*$')

def is_valid_morse(text: str) -> bool:
    return bool(VALID_MORSE_RE.match(text)) and bool(text.strip())

def verify_passcode_for_note(note, passcode: str) -> bool:
    if note['use_custom_passcode'] and note['passcode_hash']:
        return hash_value(passcode) == note['passcode_hash']
    default_hash = get_setting('default_passcode_hash')
    if not default_hash:
        return False
    return hash_value(passcode) == default_hash

# ─── Folder helpers ───────────────────────────────────────────────────────────────

def get_folder(folder_id):
    clause, params = acct.user_scope_clause()
    return get_db().execute(
        f'SELECT * FROM folders WHERE id = ? AND {clause}', (folder_id, *params)
    ).fetchone()

def get_note(note_id):
    clause, params = acct.user_scope_clause()
    return get_db().execute(
        f'SELECT * FROM notes WHERE id = ? AND {clause}', (note_id, *params)
    ).fetchone()

def current_user_id():
    return acct.get_current_user_id()

def get_breadcrumb(folder_id):
    """Return list of folders from root → current (for breadcrumb navigation)."""
    clause, params = acct.user_scope_clause()
    crumbs = []
    current = folder_id
    visited = set()
    while current and current not in visited:
        visited.add(current)
        folder = get_db().execute(
            f'SELECT * FROM folders WHERE id = ? AND {clause}', (current, *params)
        ).fetchone()
        if not folder:
            break
        crumbs.insert(0, folder)
        current = folder['parent_id']
    return crumbs

def get_all_folders_flat(exclude_id=None):
    """Return all folders sorted hierarchically with a depth value for UI indentation."""
    clause, params = acct.user_scope_clause()
    all_f = get_db().execute(
        f'SELECT * FROM folders WHERE {clause} ORDER BY name', params
    ).fetchall()

    def recurse(parent_id, depth):
        result = []
        for f in all_f:
            if f['parent_id'] == parent_id and f['id'] != exclude_id:
                result.append({'id': f['id'], 'name': f['name'], 'depth': depth})
                result.extend(recurse(f['id'], depth + 1))
        return result

    return recurse(None, 0)

def send_otp_email(to_email: str, otp: str, purpose: str) -> bool:
    if not smtp_configured():
        return False
    labels = {
        'recovery': 'Passcode Recovery',
        'recovery_passcode': 'Passcode Recovery',
        'recovery_security': 'Security Question Recovery',
    }
    subject = f"MorseVault — {labels.get(purpose, 'Verification')}"
    body = (
        f"Your MorseVault verification code is:\n\n"
        f"  {otp}\n\n"
        f"This code expires in 5 minutes. Do not share it with anyone."
    )
    try:
        msg = Message(subject=subject, recipients=[to_email], body=body)
        mail.send(msg)
        return True
    except Exception:
        return False

def smtp_configured() -> bool:
    return bool(SMTP_HOST and SMTP_USER and SMTP_PASS)

@app.context_processor
def inject_auth():
    user = acct.get_current_user()
    return {
        'auth_user': user,
        'is_logged_in': acct.is_logged_in(),
        'sync_mode': 'cloud' if acct.is_logged_in() else 'local',
        'local_note_count': acct.count_local_notes(),
    }

# ─── Folder view (shared by / and /folder/<id>) ───────────────────────────────────

def _folder_view(folder_id):
    db = get_db()
    scope, scope_params = acct.user_scope_clause('f')
    nscope, nparams = acct.user_scope_clause('n')
    sscope, sparams = acct.user_scope_clause('s')
    note_clause, note_params = acct.user_scope_clause()
    subfolder_sql = f'''
        SELECT f.*,
            (SELECT COUNT(*) FROM notes n WHERE n.folder_id = f.id AND {nscope}) AS note_count,
            (SELECT COUNT(*) FROM folders s WHERE s.parent_id = f.id AND {sscope}) AS sub_count
        FROM folders f WHERE {{where}} AND {scope} ORDER BY f.name
    '''
    if folder_id is not None:
        current_folder = get_folder(folder_id)
        if not current_folder:
            return render_template('error.html', code=404,
                                   message='Folder not found.',
                                   detail='This folder may have been deleted.'), 404
        breadcrumb = get_breadcrumb(folder_id)
        subfolders = db.execute(
            subfolder_sql.format(where='f.parent_id = ?'),
            (folder_id, *nparams, *sparams, *scope_params)
        ).fetchall()
        notes = db.execute(
            f'SELECT id, title, created_at FROM notes WHERE folder_id = ? AND {note_clause} ORDER BY created_at DESC',
            (folder_id, *note_params)
        ).fetchall()
    else:
        current_folder = None
        breadcrumb = []
        subfolders = db.execute(
            subfolder_sql.format(where='f.parent_id IS NULL'),
            (*nparams, *sparams, *scope_params)
        ).fetchall()
        notes = db.execute(
            f'SELECT id, title, created_at FROM notes WHERE folder_id IS NULL AND {note_clause} ORDER BY created_at DESC',
            note_params
        ).fetchall()

    toast = request.args.get('toast', '')
    toast_messages = {
        'saved': 'Note saved',
        'updated': 'Note updated',
        'deleted': 'Note deleted',
        'moved': 'Note moved',
        'account_created': 'Account created — notes synced',
        'logged_out': 'Logged out',
    }
    toast_label = toast_messages.get(toast, toast)
    return render_template('index.html',
                           subfolders=subfolders,
                           notes=notes,
                           breadcrumb=breadcrumb,
                           current_folder=current_folder,
                           folder_id=folder_id,
                           toast=toast_label)

# ─── Routes ───────────────────────────────────────────────────────────────────────

@app.route('/')
def index():
    return _folder_view(None)

@app.route('/folder/<int:folder_id>')
def folder_view(folder_id):
    return _folder_view(folder_id)

# ─── Folder CRUD ──────────────────────────────────────────────────────────────────

@app.route('/folder/create', methods=['POST'])
def create_folder():
    name = sanitize(request.form.get('name', ''), max_len=200)
    if not name:
        return jsonify({'error': 'Folder name cannot be empty.'}), 400
    raw_parent = request.form.get('parent_id', '') or None
    parent_id = None
    if raw_parent:
        try:
            parent_id = int(raw_parent)
        except ValueError:
            parent_id = None
    db = get_db()
    cur = db.execute(
        'INSERT INTO folders (name, parent_id, user_id) VALUES (?, ?, ?)',
        (name, parent_id, acct.get_current_user_id())
    )
    db.commit()
    return jsonify({'success': True, 'id': cur.lastrowid, 'name': name})

@app.route('/folder/<int:folder_id>/rename', methods=['POST'])
def rename_folder(folder_id):
    if not get_folder(folder_id):
        return jsonify({'error': 'Folder not found.'}), 404
    name = sanitize(request.form.get('name', ''), max_len=200)
    if not name:
        return jsonify({'error': 'Name cannot be empty.'}), 400
    db = get_db()
    clause, params = acct.user_scope_clause()
    db.execute(f'UPDATE folders SET name = ? WHERE id = ? AND {clause}', (name, folder_id, *params))
    db.commit()
    return jsonify({'success': True})

@app.route('/folder/<int:folder_id>/delete', methods=['POST'])
def delete_folder(folder_id):
    if not get_folder(folder_id):
        return jsonify({'error': 'Folder not found.'}), 404
    db = get_db()
    fscope, fparams = acct.user_scope_clause()
    nscope, nparams = acct.user_scope_clause()
    subs  = db.execute(f'SELECT COUNT(*) FROM folders WHERE parent_id = ? AND {fscope}', (folder_id, *fparams)).fetchone()[0]
    notes = db.execute(f'SELECT COUNT(*) FROM notes WHERE folder_id = ? AND {nscope}', (folder_id, *nparams)).fetchone()[0]
    if subs > 0 or notes > 0:
        return jsonify({'error': 'Folder is not empty. Move or delete its contents first.'}), 400
    clause, params = acct.user_scope_clause()
    db.execute(f'DELETE FROM folders WHERE id = ? AND {clause}', (folder_id, *params))
    db.commit()
    return jsonify({'success': True})

# ─── API: all folders list (for move-note dropdown) ───────────────────────────────

@app.route('/api/folders')
def api_folders():
    folders = get_all_folders_flat()
    return jsonify(folders)

# ─── Note: move to folder ─────────────────────────────────────────────────────────

@app.route('/note/<int:note_id>/move', methods=['POST'])
def move_note(note_id):
    db   = get_db()
    note = get_note(note_id)
    if not note:
        return jsonify({'error': 'Note not found.'}), 404
    raw_dest = request.form.get('folder_id', '') or None
    dest = None
    if raw_dest:
        try:
            dest = int(raw_dest)
            if not get_folder(dest):
                return jsonify({'error': 'Destination folder not found.'}), 404
        except ValueError:
            dest = None
    clause, params = acct.user_scope_clause()
    db.execute(f'UPDATE notes SET folder_id = ? WHERE id = ? AND {clause}', (dest, note_id, *params))
    db.commit()
    return jsonify({'success': True})

# ─── Create note ──────────────────────────────────────────────────────────────────

@app.route('/create', methods=['GET', 'POST'])
def create():
    # Resolve folder context
    raw_fid = request.args.get('folder_id') or request.form.get('folder_id') or ''
    folder_id = None
    current_folder = None
    if raw_fid:
        try:
            folder_id = int(raw_fid)
            current_folder = get_folder(folder_id)
            if not current_folder:
                folder_id = None
        except ValueError:
            pass

    has_default = bool(get_setting('default_passcode_hash'))
    error = None

    if request.method == 'POST':
        title      = sanitize(request.form.get('title', ''),      max_len=200)
        morse_text = sanitize(request.form.get('morse_text', ''), max_len=10000)
        use_custom = request.form.get('use_custom_passcode') == '1'
        passcode   = sanitize(request.form.get('passcode', ''),   max_len=200)

        if not title:
            error = 'Please enter a note title.'
        elif not morse_text:
            error = 'Please enter some Morse code.'
        elif not is_valid_morse(morse_text):
            error = 'Morse code may only contain dots (.), dashes (-), slashes (/), and spaces.'
        elif use_custom and not passcode:
            error = 'Please enter a custom passcode, or disable the custom passcode option.'
        elif not use_custom and not has_default:
            error = 'No default passcode is set. Please set one in Settings or use a custom passcode.'
        else:
            custom_hash = hash_value(passcode) if use_custom else None
            db = get_db()
            db.execute(
                'INSERT INTO notes (title, morse_text, passcode_hash, use_custom_passcode, folder_id, user_id) VALUES (?, ?, ?, ?, ?, ?)',
                (title, morse_text, custom_hash, 1 if use_custom else 0, folder_id, acct.get_current_user_id())
            )
            db.commit()
            if folder_id:
                return redirect(url_for('folder_view', folder_id=folder_id, toast='saved'))
            return redirect(url_for('index', toast='saved'))

    breadcrumb = get_breadcrumb(folder_id) if folder_id else []
    return render_template('create.html',
                           error=error,
                           has_default=has_default,
                           folder_id=folder_id,
                           current_folder=current_folder,
                           breadcrumb=breadcrumb,
                           keyboard_mode=get_setting('keyboard_mode', 'alphabet'))

# ─── View note ────────────────────────────────────────────────────────────────────

@app.route('/note/<int:note_id>')
def view_note(note_id):
    db = get_db()
    note = get_note(note_id)
    if note is None:
        return render_template('error.html', code=404,
                               message='Note not found.',
                               detail='This note may have been deleted or never existed.'), 404
    folder_id     = note['folder_id']
    breadcrumb    = get_breadcrumb(folder_id) if folder_id else []
    timer_default = get_setting('translation_timer', '30')
    auto_lock     = get_setting('auto_lock_timer', 'never')
    toast         = request.args.get('toast', '')
    toast_messages = {'saved': 'Note saved', 'updated': 'Note updated', 'deleted': 'Note deleted', 'moved': 'Note moved'}
    toast_label   = toast_messages.get(toast, toast)
    return render_template('view.html',
                           note=note,
                           folder_id=folder_id,
                           breadcrumb=breadcrumb,
                           timer_default=timer_default,
                           auto_lock_setting=auto_lock,
                           toast=toast_label)

# ─── Edit note ────────────────────────────────────────────────────────────────────

@app.route('/edit/<int:note_id>/unlock', methods=['POST'])
def unlock_edit(note_id):
    note = get_note(note_id)
    if note is None:
        return jsonify({'error': 'Note not found'}), 404
    passcode = sanitize(request.form.get('passcode', ''), max_len=200)
    if not passcode:
        return jsonify({'error': 'Passcode required'}), 400
    if not verify_passcode_for_note(note, passcode):
        return jsonify({'error': 'Incorrect passcode'}), 403
    session[f'edit_unlock_{note_id}'] = True
    return jsonify({'success': True, 'redirect': url_for('edit_note', note_id=note_id)})

@app.route('/edit/<int:note_id>', methods=['GET', 'POST'])
def edit_note(note_id):
    db   = get_db()
    note = get_note(note_id)
    if note is None:
        return render_template('error.html', code=404,
                               message='Note not found.',
                               detail='This note may have been deleted or never existed.'), 404
    has_default = bool(get_setting('default_passcode_hash'))
    error = None
    if request.method == 'GET' and not session.get(f'edit_unlock_{note_id}'):
        return redirect(url_for('view_note', note_id=note_id))
    if request.method == 'POST':
        title      = sanitize(request.form.get('title', ''),      max_len=200)
        morse_text = sanitize(request.form.get('morse_text', ''), max_len=10000)
        use_custom = request.form.get('use_custom_passcode') == '1'
        passcode   = sanitize(request.form.get('passcode', ''),   max_len=200)
        if not title:
            error = 'Please enter a note title.'
        elif not morse_text:
            error = 'Please enter some Morse code.'
        elif not is_valid_morse(morse_text):
            error = 'Morse code may only contain dots (.), dashes (-), slashes (/), and spaces.'
        elif use_custom and not passcode and not note['passcode_hash']:
            error = 'Please enter a custom passcode.'
        elif not use_custom and not has_default:
            error = 'No default passcode is set.'
        else:
            new_hash = (hash_value(passcode) if passcode else note['passcode_hash']) if use_custom else None
            clause, params = acct.user_scope_clause()
            db.execute(
                f'UPDATE notes SET title=?, morse_text=?, passcode_hash=?, use_custom_passcode=? WHERE id=? AND {clause}',
                (title, morse_text, new_hash, 1 if use_custom else 0, note_id, *params)
            )
            db.commit()
            session.pop(f'edit_unlock_{note_id}', None)
            return redirect(url_for('view_note', note_id=note_id, toast='updated'))
    return render_template('edit.html', note=note, error=error, has_default=has_default,
                           keyboard_mode=get_setting('keyboard_mode', 'alphabet'))

# ─── Translate ────────────────────────────────────────────────────────────────────

@app.route('/translate/<int:note_id>', methods=['POST'])
def translate_note(note_id):
    note = get_note(note_id)
    if note is None:
        return jsonify({'error': 'Note not found'}), 404
    passcode = sanitize(request.form.get('passcode', ''), max_len=200)
    if not passcode:
        return jsonify({'error': 'Passcode required'}), 400
    if not verify_passcode_for_note(note, passcode):
        return jsonify({'error': 'Incorrect passcode'}), 403
    return jsonify({'translation': translate_morse(note['morse_text'])})

# ─── Delete note ──────────────────────────────────────────────────────────────────

@app.route('/delete/<int:note_id>', methods=['POST'])
def delete_note(note_id):
    db   = get_db()
    note = get_note(note_id)
    if note is None:
        return jsonify({'error': 'Note not found'}), 404
    passcode = sanitize(request.form.get('passcode', ''), max_len=200)
    if not passcode:
        return jsonify({'error': 'Passcode required'}), 400
    if not verify_passcode_for_note(note, passcode):
        return jsonify({'error': 'Incorrect passcode'}), 403
    folder_id = note['folder_id']
    clause, params = acct.user_scope_clause()
    db.execute(f'DELETE FROM notes WHERE id = ? AND {clause}', (note_id, *params))
    db.commit()
    back_url = url_for('folder_view', folder_id=folder_id) if folder_id else url_for('index')
    return jsonify({'success': True, 'redirect': back_url})

def _mask_email(email: str) -> str:
    if '@' not in email:
        return email
    local, domain = email.split('@', 1)
    if len(local) <= 2:
        masked_local = local[0] + '***'
    else:
        masked_local = local[0] + '***' + local[-1]
    return f'{masked_local}@{domain}'

# ─── Account: register / login / logout ───────────────────────────────────────────

@app.route('/register', methods=['GET', 'POST'])
def register():
    error = None
    if request.method == 'POST':
        email    = sanitize(request.form.get('email', ''), max_len=300).lower()
        password = request.form.get('password', '')
        confirm  = request.form.get('confirm_password', '')
        link_local = request.form.get('link_local') == '1'
        if not acct.validate_email(email):
            error = 'Please enter a valid email address.'
        elif password != confirm:
            error = 'Passwords do not match.'
        else:
            ok, msg = acct.validate_password(password)
            if not ok:
                error = msg
            elif acct.get_user_by_email(email):
                error = 'An account with this email already exists.'
            else:
                db = get_db()
                cur = db.execute(
                    '''INSERT INTO users (email, password_hash, recovery_email)
                       VALUES (?, ?, ?)''',
                    (email, hash_value(password), email)
                )
                user_id = cur.lastrowid
                if link_local and acct.has_local_data():
                    acct.link_local_data_to_user(user_id)
                    acct.migrate_local_settings_to_user(user_id)
                db.commit()
                acct.login_user(user_id)
                return redirect(url_for('index', toast='account_created'))
    return render_template('register.html', error=error,
                           has_local_data=acct.has_local_data(),
                           local_notes=acct.count_local_notes())

@app.route('/login', methods=['GET', 'POST'])
def login():
    error = None
    if request.method == 'POST':
        email    = sanitize(request.form.get('email', ''), max_len=300).lower()
        password = request.form.get('password', '')
        user = acct.get_user_by_email(email)
        if not user or hash_value(password) != user['password_hash']:
            error = 'Invalid email or password.'
        else:
            acct.login_user(user['id'])
            nxt = request.args.get('next') or url_for('index')
            return redirect(nxt)
    return render_template('login.html', error=error)

@app.route('/logout')
def logout():
    acct.logout_user()
    return redirect(url_for('index', toast='logged_out'))

@app.route('/send-recovery-otp', methods=['POST'])
def send_recovery_otp_route():
    purpose = sanitize(request.form.get('purpose', ''), max_len=30)
    if purpose not in ('recovery_passcode', 'recovery_security'):
        return jsonify({'error': 'Invalid purpose.'}), 400
    email = sanitize(request.form.get('email', ''), max_len=300).lower()
    if not acct.validate_email(email):
        return jsonify({'error': 'Please enter a valid email address.'}), 400
    user = acct.get_user_by_email(email)
    if not user:
        return jsonify({'error': 'No account found for this email.'}), 404
    ok, target_or_msg = acct.send_recovery_otp(user['id'], purpose)
    if not ok:
        return jsonify({'error': target_or_msg}), 503
    session['recovery_user_id'] = user['id']
    session['recovery_purpose'] = purpose
    session['recovery_step'] = 'code'
    return jsonify({'success': True, 'message': f'Verification code sent to {_mask_email(target_or_msg)}.'})

# ─── Settings ─────────────────────────────────────────────────────────────────────

@app.route('/settings', methods=['GET', 'POST'])
def settings():
    error = success = None
    section = request.args.get('section', '')
    if section and section not in VALID_SETTINGS_SECTIONS:
        section = ''

    if request.method == 'POST':
        action = request.form.get('action', '')
        section = request.form.get('section') or section

        if action == 'set_default_passcode':
            section = 'default-passcode'
            existing = get_setting('default_passcode_hash')
            if existing:
                if hash_value(sanitize(request.form.get('current_passcode', ''), 200)) != existing:
                    error = 'Current passcode is incorrect.'
                    return _settings_render(error, success, section)
            new_pass = sanitize(request.form.get('new_passcode', ''),     200)
            confirm  = sanitize(request.form.get('confirm_passcode', ''), 200)
            if not new_pass:
                error = 'New passcode cannot be empty.'
            elif new_pass != confirm:
                error = 'Passcodes do not match.'
            else:
                set_setting('default_passcode_hash', hash_value(new_pass))
                success = 'Default passcode updated.'

        elif action == 'set_security':
            section = 'security-question'
            q = sanitize(request.form.get('security_question', ''), 300).strip()
            a = sanitize(request.form.get('security_answer', ''),   300).strip()
            current_a = sanitize(request.form.get('current_security_answer', ''), 300).strip()
            existing_q = get_setting('security_question', '')
            existing_hash = get_setting('security_answer_hash', '')
            if not q:
                error = 'Please enter a security question.'
            elif not a:
                error = 'Please enter a security answer.'
            elif len(a) < 2:
                error = 'Security answer must be at least 2 characters.'
            elif existing_hash and hash_value(current_a.lower()) != existing_hash:
                error = 'Current security answer is incorrect.'
            else:
                set_setting('security_question', q)
                set_setting('security_answer_hash', hash_value(a.lower()))
                success = 'Security question saved.'

        elif action == 'set_timer':
            section = 'translation-timer'
            timer = request.form.get('translation_timer', '30')
            if timer in ['10', '30', '60', '1800', '3600', 'never']:
                set_setting('translation_timer', timer)
                success = 'Translation timer saved.'
            else:
                error = 'Invalid timer value.'

        elif action == 'set_auto_lock':
            section = 'auto-lock-timer'
            lock = request.form.get('auto_lock_timer', 'never')
            if lock in ['10', '30', '60', '300', '1800', 'never']:
                set_setting('auto_lock_timer', lock)
                success = 'Auto-lock timer saved.'
            else:
                error = 'Invalid auto-lock value.'

        elif action == 'set_keyboard_mode':
            section = 'keyboard-mode'
            mode = request.form.get('keyboard_mode', 'alphabet')
            if mode in VALID_KEYBOARD_MODES:
                set_setting('keyboard_mode', mode)
                success = 'Keyboard mode saved.'
            else:
                error = 'Invalid keyboard mode.'

        elif action == 'link_local_notes':
            section = 'account'
            if not acct.is_logged_in():
                error = 'You must be logged in to link local notes.'
            elif not acct.has_local_data():
                error = 'No local notes to link.'
            else:
                uid = acct.get_current_user_id()
                acct.link_local_data_to_user(uid)
                acct.migrate_local_settings_to_user(uid)
                success = 'Local notes linked to your account.'

    success = success or request.args.get('success')
    return _settings_render(error, success, section)

def _settings_render(error, success, section=''):
    if section and section not in VALID_SETTINGS_SECTIONS:
        section = ''
    user = acct.get_current_user()
    return render_template('settings.html',
        section           = section,
        has_default       = bool(get_setting('default_passcode_hash')),
        has_security      = bool(get_setting('security_question')),
        security_q        = get_setting('security_question', ''),
        timer_setting     = get_setting('translation_timer', '30'),
        auto_lock_setting = get_setting('auto_lock_timer', 'never'),
        keyboard_mode     = get_setting('keyboard_mode', 'alphabet'),
        smtp_configured   = smtp_configured(),
        error=error, success=success)

# ─── Forgot passcode (recovery email OTP only) ────────────────────────────────────

@app.route('/forgot-passcode', methods=['GET', 'POST'])
def forgot_passcode():
    error = None
    step = session.get('recovery_step', 'email') if session.get('recovery_purpose') == 'recovery_passcode' else 'email'

    if request.method == 'POST':
        action = request.form.get('action', '')

        if action == 'verify_code':
            user_id = session.get('recovery_user_id')
            if not user_id:
                error = 'Session expired. Please start over.'
            else:
                code = sanitize(request.form.get('code', ''), 10)
                ok, msg = acct.check_recovery_otp(user_id, code, 'recovery_passcode')
                if not ok:
                    error = msg
                else:
                    session['recovery_step'] = 'reset'
                    session['recovery_purpose'] = 'recovery_passcode'
                    return redirect(url_for('forgot_passcode'))

        elif action == 'set_new_passcode':
            user_id = session.get('recovery_user_id')
            if session.get('recovery_step') != 'reset' or not user_id:
                return redirect(url_for('forgot_passcode'))
            new_pass = sanitize(request.form.get('new_passcode', ''), 200)
            confirm  = sanitize(request.form.get('confirm_passcode', ''), 200)
            if not new_pass:
                error = 'Passcode cannot be empty.'
            elif new_pass != confirm:
                error = 'Passcodes do not match.'
            else:
                h = hash_value(new_pass)
                db = get_db()
                db.execute('UPDATE users SET default_passcode_hash=? WHERE id=?', (h, user_id))
                db.commit()
                session.pop('recovery_step', None)
                session.pop('recovery_purpose', None)
                acct.login_user(user_id)
                session.pop('recovery_user_id', None)
                return redirect(url_for('settings', section='default-passcode') + '&success=Passcode+reset')

    step = session.get('recovery_step', 'email') if session.get('recovery_purpose') == 'recovery_passcode' else 'email'
    return render_template('forgot_passcode.html', step=step, error=error, smtp_configured=smtp_configured())

# ─── Forgot security question (recovery email OTP only) ─────────────────────────

@app.route('/forgot-security', methods=['GET', 'POST'])
def forgot_security():
    error = None
    step = session.get('recovery_step', 'email') if session.get('recovery_purpose') == 'recovery_security' else 'email'

    if request.method == 'POST':
        action = request.form.get('action', '')

        if action == 'verify_code':
            user_id = session.get('recovery_user_id')
            if not user_id:
                error = 'Session expired. Please start over.'
            else:
                code = sanitize(request.form.get('code', ''), 10)
                ok, msg = acct.check_recovery_otp(user_id, code, 'recovery_security')
                if not ok:
                    error = msg
                else:
                    session['recovery_step'] = 'reset'
                    session['recovery_purpose'] = 'recovery_security'
                    return redirect(url_for('forgot_security'))

        elif action == 'set_new_security':
            user_id = session.get('recovery_user_id')
            if session.get('recovery_step') != 'reset' or not user_id:
                return redirect(url_for('forgot_security'))
            q = sanitize(request.form.get('security_question', ''), 300).strip()
            a = sanitize(request.form.get('security_answer', ''), 300).strip()
            if not q or not a:
                error = 'Please provide both a question and answer.'
            elif len(a) < 2:
                error = 'Security answer must be at least 2 characters.'
            else:
                ah = hash_value(a.lower())
                db = get_db()
                db.execute(
                    'UPDATE users SET security_question=?, security_answer_hash=? WHERE id=?',
                    (q, ah, user_id)
                )
                db.commit()
                session.pop('recovery_step', None)
                session.pop('recovery_purpose', None)
                acct.login_user(user_id)
                session.pop('recovery_user_id', None)
                return redirect(url_for('settings', section='security-question') + '&success=Security+question+reset')

    step = session.get('recovery_step', 'email') if session.get('recovery_purpose') == 'recovery_security' else 'email'
    return render_template('forgot_security.html', step=step, error=error, smtp_configured=smtp_configured())

# ─── Security headers (web hardening) ─────────────────────────────────────────────

@app.after_request
def set_security_headers(response):
    response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
    response.headers['Pragma'] = 'no-cache'
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['Referrer-Policy'] = 'no-referrer'
    response.headers['X-Frame-Options'] = 'DENY'
    return response

# ─── Error handlers ───────────────────────────────────────────────────────────────

@app.errorhandler(404)
def not_found(e):
    return render_template('error.html', code=404,
                           message='Page not found.',
                           detail='The page you requested does not exist.'), 404

@app.errorhandler(500)
def server_error(e):
    return render_template('error.html', code=500,
                           message='Something went wrong.',
                           detail='An internal error occurred. Please try again.'), 500

# ─── Entry point ──────────────────────────────────────────────────────────────────

acct.init_account(app, get_db, hash_value, sanitize, send_otp_email, smtp_configured)
init_db()

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8000))
    app.run(host='0.0.0.0', port=port, debug=False)
