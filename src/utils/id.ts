const UUID_BODY_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

function trimId(value: string | undefined): string {
    return value?.trim() ?? '';
}

export function isBraceWrappedId(value: string | undefined): boolean {
    const trimmed = trimId(value);
    return trimmed.startsWith('{') && trimmed.endsWith('}') && trimmed.length > 2;
}

export function unwrapBracedId(value: string | undefined): string {
    const trimmed = trimId(value);
    return isBraceWrappedId(trimmed) ? trimmed.slice(1, -1) : trimmed;
}

export function isUuidLikeId(value: string | undefined): boolean {
    return UUID_BODY_PATTERN.test(unwrapBracedId(value));
}

export function preferBracedId(value: string | undefined): string {
    const trimmed = trimId(value);
    if (!trimmed) {
        return '';
    }
    if (isBraceWrappedId(trimmed)) {
        return trimmed;
    }
    return isUuidLikeId(trimmed) ? `{${trimmed}}` : trimmed;
}

export function canonicalIdKey(value: string | undefined): string {
    const body = unwrapBracedId(value);
    return UUID_BODY_PATTERN.test(body) ? body.toLowerCase() : body;
}