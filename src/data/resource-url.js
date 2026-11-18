const viteBase = import.meta.env?.BASE_URL;

export function normalizeBasePath(value = '/') {
    if (typeof value !== 'string' || !value.trim()) return '/';
    const base = value.startsWith('/') ? value : `/${value}`;
    return `${base.replace(/\/+$/, '')}/`;
}

export const resourceBasePath = normalizeBasePath(viteBase || '/');

export function resourceUrl(path, basePath = resourceBasePath) {
    if (typeof path !== 'string') throw new TypeError('资源路径无效');
    return `${normalizeBasePath(basePath)}${path.replace(/^\/+/, '')}`;
}
