rsa# MorseVault

A secure Morse-code note management system built with Python Flask and SQLite.(An andriode app/website)

---

## Overview

MorseVault lets users write and save Morse-code notes, then unlock an English translation only by entering the correct passcode. Notes are stored in a local SQLite database. Translations are never saved — they are visible only after a successful passcode check and disappear after 30 seconds.

---

## Technologies Used

| Layer     | Technology                        |
|-----------|-----------------------------------|
| Backend   | Python 3.11, Flask                |
| Database  | SQLite (built-in, no setup)       |
| Frontend  | HTML5, CSS3, JavaScript (vanilla) |
| Security  | hashlib SHA-256 (passcode hashing)|
| Fonts     | Inter (Google Fonts)              |

---

## Features

- **Create notes** — Enter a title, Morse code text, and a passcode
- **View notes** — See saved Morse text in a clean card layout
- **Translate** — Click "Translate Here", enter your passcode, and see the English text
- **Edit notes** — Update title, Morse text, or change passcode
- **Delete notes** — Remove notes with a confirmation prompt
- **Search** — Filter notes by title in real time
- **Dark mode** — Toggle between light and dark themes (saved in localStorage)
- **Copy protection** — Morse and translated text blocks are protected from selection and copying
- **Auto-hide translation** — Translated text disappears after 30 seconds
- **Relative timestamps** — Notes show "Today", "Yesterday", or "3 days ago"

---

## Installation

**Requirements:** Python 3.11+

```bash
# 1. Clone or download the project
cd morse-vault

# 2. Install dependencies
pip install -r requirements.txt

# 3. Run the app
python app.py
```

Open your browser at: **http://localhost:8000**

The SQLite database (`database.db`) is created automatically on the first run.

---

## Project Structure

```
morse-vault/
├── app.py              # Flask application — routes, helpers, error handlers
├── morse_logic.py      # Morse-to-English translation logic
├── database.db         # SQLite database (auto-generated)
├── requirements.txt    # Python dependencies
├── README.md           # Project documentation
│
├── templates/
│   ├── base.html       # Shared layout (header, footer, dark mode toggle)
│   ├── index.html      # Dashboard — list all notes + search
│   ├── create.html     # Create a new note
│   ├── edit.html       # Edit an existing note
│   ├── view.html       # View a note + passcode-protected translation
│   └── error.html      # 404 / 500 error page
│
└── static/
    ├── style.css       # All styles — light/dark themes, responsive layout
    └── script.js       # Dark mode, search, toast notifications, copy protection
```

---

## How It Works

```
User creates note
    ↓
Title + Morse text + Passcode entered
    ↓
Passcode hashed (SHA-256) → stored in SQLite
Plain passcode is never saved
    ↓
User opens saved note
    ↓
Clicks "Translate Here" → passcode modal opens
    ↓
Flask hashes entered passcode → compares with stored hash
    ↓
  Match → Morse translated → shown for 30 seconds
  No match → "Incorrect passcode" shown
```

---

## Morse Code Format

Use standard Morse notation:

- **Dot** → `.`
- **Dash** → `-`
- **Space between letters** → single space
- **Space between words** → ` / `

**Example:**

```
.... . .-.. .-.. --- / .-- --- .-. .-.. -..
```
Translates to: `HELLO WORLD`

---

## Security Notes

- Passcodes are hashed with SHA-256 before storage — never stored in plain text
- Translations are computed on demand and never written to the database
- Translation results auto-hide after 30 seconds
- Morse and translated text are protected from clipboard copying
- Input is sanitized and length-capped on all routes

---

## Future Improvements

- Passcode strength validation
- Note categories or tags
- Export notes to a text file
- English-to-Morse encoder on the Create page
- Session-based access for multi-device use

---

## Project Info

**Type:** Python Flask Mini Project  
**Database:** SQLite (local, no server required)  
**Frontend:** Vanilla HTML / CSS / JavaScript — no frameworks  
