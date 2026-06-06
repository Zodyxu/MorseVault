"""
MorseVault account layer — users, scoped data, settings, recovery OTP.
"""
from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone

from flask import session, g

# Imported lazily from app to avoid circular imports at module level
_app = None


def init_account(app, get_db, hash_value, sanitize, send_otp_email_fn, smtp_configured_fn):
    global _app
    _app = {
        'get_db': get_db,
        'hash_value': hash_value,
        'sanitize': sanitize,
        'send_otp_email': send_otp_email_fn,
        'smtp_configured': smtp_configured_fn,
    }


def _db():
    return _app['get_db']()


def _hash(v: str) -> str:
    return _app['hash_value'](v)


def get_current_user_id():
    return session.get('user_id')


def is_logged_in() -> bool:
    return get_current_user_id() is not None


def get_current_user():
    uid = get_current_user_id()
    if not uid:
        return None
    return _db().execute('SELECT * FROM users WHERE id = ?', (uid,)).fetchone()


def get_user_by_email(email: str):
    return _db().execute(
        'SELECT * FROM users WHERE LOWER(email) = LOWER(?)', (email.strip(),)
    ).fetchone()


def login_user(user_id: int):
    session['user_id'] = user_id
    session.permanent = True


def logout_user():
    session.pop('user_id', None)
    session.pop('recovery_step', None)
    session.pop('recovery_user_id', None)
    session.pop('recovery_purpose', None)
    for key in list(session.keys()):
        if key.startswith('edit_unlock_'):
            session.pop(key, None)


def user_scope_clause(table_alias: str = '') -> tuple[str, list]:
    """SQL fragment restricting rows to current user or local-only."""
    prefix = f'{table_alias}.' if table_alias else ''
    uid = get_current_user_id()
    if uid:
        return f'{prefix}user_id = ?', [uid]
    return f'{prefix}user_id IS NULL', []


def count_local_notes() -> int:
    return _db().execute(
        'SELECT COUNT(*) FROM notes WHERE user_id IS NULL'
    ).fetchone()[0]


def count_local_folders() -> int:
    return _db().execute(
        'SELECT COUNT(*) FROM folders WHERE user_id IS NULL'
    ).fetchone()[0]


def has_local_data() -> bool:
    return count_local_notes() > 0 or count_local_folders() > 0


def link_local_data_to_user(user_id: int):
    db = _db()
    db.execute('UPDATE notes SET user_id = ? WHERE user_id IS NULL', (user_id,))
    db.execute('UPDATE folders SET user_id = ? WHERE user_id IS NULL', (user_id,))
    db.commit()


def migrate_local_settings_to_user(user_id: int):
    """Copy global settings into user row when linking account."""
    db = _db()
    keys = {
        'default_passcode_hash': 'default_passcode_hash',
        'security_question': 'security_question',
        'security_answer_hash': 'security_answer_hash',
        'translation_timer': 'translation_timer',
        'auto_lock_timer': 'auto_lock_timer',
        'keyboard_mode': 'keyboard_mode',
    }
    updates = {}
    for col, setting_key in keys.items():
        row = db.execute('SELECT value FROM settings WHERE key = ?', (setting_key,)).fetchone()
        if row and row['value']:
            updates[col] = row['value']
    if updates:
        sets = ', '.join(f'{k} = ?' for k in updates)
        db.execute(f'UPDATE users SET {sets} WHERE id = ?', [*updates.values(), user_id])
        db.commit()


# ─── User-scoped settings ─────────────────────────────────────────────────────────

_USER_COLS = {
    'default_passcode_hash': 'default_passcode_hash',
    'security_question': 'security_question',
    'security_answer_hash': 'security_answer_hash',
    'translation_timer': 'translation_timer',
    'auto_lock_timer': 'auto_lock_timer',
    'keyboard_mode': 'keyboard_mode',
}


def get_user_pref(key: str, default=None):
    if is_logged_in():
        user = get_current_user()
        if user and key in _USER_COLS:
            val = user[_USER_COLS[key]]
            return val if val is not None and val != '' else default
    row = _db().execute('SELECT value FROM settings WHERE key = ?', (key,)).fetchone()
    return row['value'] if row else default


def set_user_pref(key: str, value: str):
    if is_logged_in():
        col = _USER_COLS.get(key, key)
        _db().execute(f'UPDATE users SET {col} = ? WHERE id = ?', (value, get_current_user_id()))
        _db().commit()
    else:
        _db().execute(
            'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', (key, value)
        )
        _db().commit()


def get_recovery_email():
    if is_logged_in():
        user = get_current_user()
        return (user['recovery_email'] or user['email']) if user else ''
    return get_user_pref('user_email', '')


# ─── OTP (recovery only) ────────────────────────────────────────────────────────────

def store_recovery_otp(user_id: int, purpose: str) -> str:
    import secrets
    otp = str(secrets.randbelow(900000) + 100000)
    expiry = (datetime.now(timezone.utc) + timedelta(minutes=5)).isoformat()
    db = _db()
    db.execute('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)',
               (f'otp_code_{user_id}', otp))
    db.execute('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)',
               (f'otp_expiry_{user_id}', expiry))
    db.execute('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)',
               (f'otp_purpose_{user_id}', purpose))
    db.commit()
    return otp


def check_recovery_otp(user_id: int, code: str, purpose: str) -> tuple[bool, str]:
    db = _db()
    stored = db.execute(
        'SELECT value FROM settings WHERE key = ?', (f'otp_code_{user_id}',)
    ).fetchone()
    expiry_s = db.execute(
        'SELECT value FROM settings WHERE key = ?', (f'otp_expiry_{user_id}',)
    ).fetchone()
    stored_p = db.execute(
        'SELECT value FROM settings WHERE key = ?', (f'otp_purpose_{user_id}',)
    ).fetchone()
    stored = stored['value'] if stored else ''
    expiry_s = expiry_s['value'] if expiry_s else ''
    stored_p = stored_p['value'] if stored_p else ''
    if not stored:
        return False, 'No code found. Please request a new one.'
    if stored_p != purpose:
        return False, 'Code purpose mismatch. Please request a new code.'
    try:
        expiry = datetime.fromisoformat(expiry_s)
        if expiry.tzinfo is None:
            expiry = expiry.replace(tzinfo=timezone.utc)
        if datetime.now(timezone.utc) > expiry:
            _clear_recovery_otp(user_id)
            return False, 'Code expired. Please request a new one.'
    except Exception:
        return False, 'Invalid code state.'
    if code.strip() != stored:
        return False, 'Incorrect code. Please try again.'
    _clear_recovery_otp(user_id)
    return True, 'OK'


def _clear_recovery_otp(user_id: int):
    db = _db()
    for suffix in ('otp_code', 'otp_expiry', 'otp_purpose'):
        db.execute('DELETE FROM settings WHERE key = ?', (f'{suffix}_{user_id}',))
    db.commit()


def send_recovery_otp(user_id: int, purpose: str) -> tuple[bool, str]:
    user = _db().execute('SELECT * FROM users WHERE id = ?', (user_id,)).fetchone()
    if not user:
        return False, 'Account not found.'
    target = user['recovery_email'] or user['email']
    if not _app['smtp_configured']():
        return False, 'Email service not configured on server.'
    otp = store_recovery_otp(user_id, purpose)
    labels = {
        'recovery_passcode': 'Passcode Recovery',
        'recovery_security': 'Security Question Recovery',
    }
    sent = _app['send_otp_email'](target, otp, purpose)
    if not sent:
        _clear_recovery_otp(user_id)
        return False, 'Unable to send email. Try again later.'
    return True, target


def validate_email(email: str) -> bool:
    email = email.strip()
    return bool(email and '@' in email and '.' in email.split('@')[-1])


def validate_password(password: str) -> tuple[bool, str]:
    if len(password) < 8:
        return False, 'Password must be at least 8 characters.'
    return True, ''
