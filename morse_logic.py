"""
morse_logic.py
Morse-to-English translation for MorseVault.

Separator rules:
  - Single space  → between letters in the same word
  - Forward slash → between words  (e.g. ".- / -...")
"""

MORSE_TO_ENGLISH: dict[str, str] = {
    # Letters
    '.-':    'A', '-...':  'B', '-.-.':  'C', '-..':   'D',
    '.':     'E', '..-.':  'F', '--.':   'G', '....':  'H',
    '..':    'I', '.---':  'J', '-.-':   'K', '.-..':  'L',
    '--':    'M', '-.':    'N', '---':   'O', '.--.':  'P',
    '--.-':  'Q', '.-.':   'R', '...':   'S', '-':     'T',
    '..-':   'U', '...-':  'V', '.--':   'W', '-..-':  'X',
    '-.--':  'Y', '--..':  'Z',
    # Numbers
    '.----': '1', '..---': '2', '...--': '3', '....-': '4',
    '.....': '5', '-....': '6', '--...': '7', '---..': '8',
    '----.': '9', '-----': '0',
    # Punctuation
    '.-.-.-': '.', '--..--': ',', '..--..': '?', '.----.': "'",
    '-.-.--': '!', '-..-.':  '/', '-.--.':  '(', '-.--.-': ')',
    '.-...':  '&', '---...': ':', '-.-.-.': ';', '-...-':  '=',
    '.-.-.':  '+', '-....-': '-', '..--.-': '_', '.-..-.': '"',
    '...-..-': '$', '.--.-.': '@', '...---...': 'SOS',
}


def _normalize(text: str) -> str:
    """Collapse runs of spaces/slashes and strip leading/trailing whitespace."""
    import re
    text = text.strip()
    # Normalise word separators: any run of spaces around a slash → ' / '
    text = re.sub(r'\s*/\s*', ' / ', text)
    # Collapse multiple consecutive spaces (but not slash separators)
    text = re.sub(r'[ \t]{2,}', ' ', text)
    return text


def translate_morse(morse_text: str) -> str:
    """
    Translate a Morse-code string to English.

    Returns the translated string. Unknown symbols are rendered as '?'.
    Returns an empty string if the input is blank.
    """
    if not morse_text or not morse_text.strip():
        return ''

    text = _normalize(morse_text)
    words = text.split('/')
    result: list[str] = []

    for word in words:
        tokens = word.strip().split()
        letters: list[str] = []
        for token in tokens:
            token = token.strip()
            if not token:
                continue
            decoded = MORSE_TO_ENGLISH.get(token)
            if decoded is not None:
                letters.append(decoded)
            else:
                letters.append('?')  # unknown symbol — rendered visibly
        if letters:
            result.append(''.join(letters))

    translated = ' '.join(result)
    return translated
