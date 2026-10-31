#!/usr/bin/env python3
"""
SimplePass Manager - Native Messaging Host for UNIX pass CLI
Standard Chrome / WebExtensions Native Messaging Host Protocol.
Enables secure local password store (~/.password-store) synchronization.
"""

import sys
import os
import json
import struct
import subprocess
import shutil
from pathlib import Path

PASSWORD_STORE_DIR = os.environ.get('PASSWORD_STORE_DIR', os.path.expanduser('~/.password-store'))

def get_pass_executable():
    return shutil.which('pass')

def get_gpg_executable():
    return shutil.which('gpg')

def read_message():
    """Reads a message from stdin with a 32-bit length prefix."""
    raw_length = sys.stdin.buffer.read(4)
    if not raw_length or len(raw_length) < 4:
        return None
    message_length = struct.unpack('<I', raw_length)[0]
    raw_message = sys.stdin.buffer.read(message_length)
    if not raw_message or len(raw_message) < message_length:
        return None
    return json.loads(raw_message.decode('utf-8'))

def send_message(message):
    """Sends a message to stdout with a 32-bit length prefix."""
    encoded_message = json.dumps(message).encode('utf-8')
    sys.stdout.buffer.write(struct.pack('<I', len(encoded_message)))
    sys.stdout.buffer.write(encoded_message)
    sys.stdout.buffer.flush()

def list_pass_entries():
    """Walks the ~/.password-store directory and lists all .gpg entries."""
    store_path = Path(PASSWORD_STORE_DIR)
    if not store_path.exists():
        return []

    entries = []
    for root, dirs, files in os.walk(store_path):
        # Ignore git and hidden directories
        dirs[:] = [d for d in dirs if not d.startswith('.')]
        for f in files:
            if f.endswith('.gpg') and not f.startswith('.'):
                full_path = Path(root) / f
                rel_path = full_path.relative_to(store_path)
                # Strip .gpg extension
                entry_name = str(rel_path)[:-4]
                entries.append(entry_name)
    entries.sort()
    return entries

def handle_check():
    pass_bin = get_pass_executable()
    gpg_bin = get_gpg_executable()
    store_exists = os.path.isdir(PASSWORD_STORE_DIR)
    entries = list_pass_entries() if store_exists else []

    return {
        'ok': True,
        'passInstalled': pass_bin is not None,
        'passPath': pass_bin or '',
        'gpgInstalled': gpg_bin is not None,
        'gpgPath': gpg_bin or '',
        'storePath': PASSWORD_STORE_DIR,
        'storeExists': store_exists,
        'entriesCount': len(entries),
        'version': '1.0.0'
    }

def sanitize_entry_path(entry_path):
    """Guards against path traversal attacks and validates path inside store."""
    if not entry_path or not isinstance(entry_path, str):
        return None
    cleaned = entry_path.strip()
    if not cleaned or cleaned.startswith(('/', '~')) or '\\' in cleaned or '..' in cleaned:
        return None
    try:
        store = Path(PASSWORD_STORE_DIR).resolve()
        target = (store / cleaned).resolve()
        if store not in target.parents and target != store:
            return None
        return cleaned
    except Exception:
        return None

def handle_list():
    entries = list_pass_entries()
    return {
        'ok': True,
        'entries': entries,
        'storePath': PASSWORD_STORE_DIR
    }

def handle_get(entry_path):
    sanitized = sanitize_entry_path(entry_path)
    if not sanitized:
        return {'ok': False, 'error': 'Invalid entry path'}

    pass_bin = get_pass_executable()
    if pass_bin:
        try:
            res = subprocess.run([pass_bin, 'show', sanitized], capture_output=True, text=True, timeout=15)
            if res.returncode == 0:
                return {'ok': True, 'path': sanitized, 'content': res.stdout}
            return {'ok': False, 'error': res.stderr.strip() or 'Failed to read entry from pass'}
        except subprocess.TimeoutExpired:
            return {'ok': False, 'error': 'Operation timed out (pass CLI)'}

    # Fallback to direct gpg
    gpg_bin = get_gpg_executable()
    file_path = os.path.join(PASSWORD_STORE_DIR, f"{sanitized}.gpg")
    if gpg_bin and os.path.exists(file_path):
        try:
            res = subprocess.run([gpg_bin, '--decrypt', '--quiet', file_path], capture_output=True, text=True, timeout=15)
            if res.returncode == 0:
                return {'ok': True, 'path': sanitized, 'content': res.stdout}
            return {'ok': False, 'error': res.stderr.strip() or 'Failed to decrypt entry with gpg'}
        except subprocess.TimeoutExpired:
            return {'ok': False, 'error': 'Operation timed out (gpg decrypt)'}

    return {'ok': False, 'error': 'Neither pass nor gpg executable found'}

def handle_insert(entry_path, content):
    sanitized = sanitize_entry_path(entry_path)
    if not sanitized:
        return {'ok': False, 'error': 'Invalid entry path'}

    pass_bin = get_pass_executable()
    if not pass_bin:
        return {'ok': False, 'error': 'pass executable not found in PATH'}

    # Use 'pass insert -m -f <entry_path>'
    try:
        res = subprocess.run([pass_bin, 'insert', '-m', '-f', sanitized], input=content, capture_output=True, text=True, timeout=15)
        if res.returncode == 0:
            return {'ok': True, 'path': sanitized}
        return {'ok': False, 'error': res.stderr.strip() or 'Failed to insert entry into pass'}
    except subprocess.TimeoutExpired:
        return {'ok': False, 'error': 'Operation timed out (pass insert)'}

def handle_delete(entry_path):
    sanitized = sanitize_entry_path(entry_path)
    if not sanitized:
        return {'ok': False, 'error': 'Invalid entry path'}

    pass_bin = get_pass_executable()
    if not pass_bin:
        return {'ok': False, 'error': 'pass executable not found in PATH'}

    try:
        res = subprocess.run([pass_bin, 'rm', '-f', sanitized], capture_output=True, text=True, timeout=15)
        if res.returncode == 0:
            return {'ok': True, 'path': sanitized}
        return {'ok': False, 'error': res.stderr.strip() or 'Failed to delete entry from pass'}
    except subprocess.TimeoutExpired:
        return {'ok': False, 'error': 'Operation timed out (pass delete)'}

def handle_sync_all():
    entries = list_pass_entries()
    pass_bin = get_pass_executable()
    items = []

    for entry in entries:
        if pass_bin:
            res = subprocess.run([pass_bin, 'show', entry], capture_output=True, text=True)
            if res.returncode == 0:
                items.append({'path': entry, 'content': res.stdout})
        else:
            get_res = handle_get(entry)
            if get_res.get('ok'):
                items.append({'path': entry, 'content': get_res.get('content')})

    return {
        'ok': True,
        'count': len(items),
        'items': items
    }

def main():
    while True:
        try:
            msg = read_message()
            if msg is None:
                break

            action = msg.get('action') or msg.get('type')
            if action in ('ping', 'check'):
                response = handle_check()
            elif action == 'list':
                response = handle_list()
            elif action == 'get':
                response = handle_get(msg.get('path', ''))
            elif action == 'insert':
                response = handle_insert(msg.get('path', ''), msg.get('content', ''))
            elif action == 'delete':
                response = handle_delete(msg.get('path', ''))
            elif action == 'sync_all':
                response = handle_sync_all()
            else:
                response = {'ok': False, 'error': f"Unknown action: {action}"}

            send_message(response)
        except Exception as e:
            send_message({'ok': False, 'error': str(e)})

if __name__ == '__main__':
    main()
