import re


def escape_markdown_v2(text: str) -> str:
    """Escape special characters for Telegram MarkdownV2 format."""
    special_chars = r"_*[]()~`>#+-=|{}.!"
    escaped = ""
    for char in text:
        if char in special_chars:
            escaped += f"\\{char}"
        else:
            escaped += char
    return escaped


def format_for_telegram(text: str) -> str:
    """
    Convert standard Markdown to Telegram MarkdownV2 format.
    Handles code blocks, inline code, bold, italic while escaping other special chars.
    """
    if not text:
        return ""

    # Extract code blocks first to protect them
    code_blocks = []
    code_block_pattern = re.compile(r"```(\w*)\n?(.*?)```", re.DOTALL)

    def replace_code_block(match):
        lang = match.group(1)
        code = match.group(2).rstrip("\n")
        idx = len(code_blocks)
        code_blocks.append((lang, code))
        return f"__CODE_BLOCK_{idx}__"

    text = code_block_pattern.sub(replace_code_block, text)

    # Extract inline code
    inline_codes = []
    inline_pattern = re.compile(r"`([^`]+)`")

    def replace_inline(match):
        idx = len(inline_codes)
        inline_codes.append(match.group(1))
        return f"__INLINE_CODE_{idx}__"

    text = inline_pattern.sub(replace_inline, text)

    # Extract bold
    bolds = []
    bold_pattern = re.compile(r"\*\*(.+?)\*\*")

    def replace_bold(match):
        idx = len(bolds)
        bolds.append(match.group(1))
        return f"__BOLD_{idx}__"

    text = bold_pattern.sub(replace_bold, text)

    # Extract italic
    italics = []
    italic_pattern = re.compile(r"(?<!\*)\*([^*]+?)\*(?!\*)")

    def replace_italic(match):
        idx = len(italics)
        italics.append(match.group(1))
        return f"__ITALIC_{idx}__"

    text = italic_pattern.sub(replace_italic, text)

    # Escape remaining text
    text = escape_markdown_v2(text)

    # Restore formatting
    for idx, content in enumerate(bolds):
        text = text.replace(f"__BOLD_{idx}__", f"*{escape_markdown_v2(content)}*")

    for idx, content in enumerate(italics):
        text = text.replace(f"__ITALIC_{idx}__", f"_{escape_markdown_v2(content)}_")

    for idx, code in enumerate(inline_codes):
        text = text.replace(f"__INLINE\\_CODE\\_{idx}__", f"`{code}`")
        # Also handle unescaped version in case
        text = text.replace(f"__INLINE_CODE_{idx}__", f"`{code}`")

    for idx, (lang, code) in enumerate(code_blocks):
        block = f"```{lang}\n{code}\n```"
        text = text.replace(f"__CODE\\_BLOCK\\_{idx}__", block)
        text = text.replace(f"__CODE_BLOCK_{idx}__", block)

    return text


def split_message(text: str, max_length: int = 4000) -> list[str]:
    """
    Split a long message into chunks that fit Telegram's 4096 char limit.
    Tries to split at newlines or spaces to avoid breaking words.
    """
    if len(text) <= max_length:
        return [text]

    chunks = []
    while text:
        if len(text) <= max_length:
            chunks.append(text)
            break

        # Try to split at a newline
        split_pos = text.rfind("\n", 0, max_length)
        if split_pos == -1 or split_pos < max_length // 2:
            # Try to split at a space
            split_pos = text.rfind(" ", 0, max_length)
        if split_pos == -1 or split_pos < max_length // 2:
            # Force split at max_length
            split_pos = max_length

        chunks.append(text[:split_pos])
        text = text[split_pos:].lstrip("\n")

    return chunks
