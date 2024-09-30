/**
 * @typedef {Object} CookieOptions
 * @property {string} [domain] - cookie的域
 * @property {string} [path] - cookie的路径
 * @property {Date} [expires] - cookie的过期日期
 * @property {boolean} [secure] - 是否仅通过https安全协议传输cookie
 * @property {('Strict'|'Lax'|'None')} [sameSite] - cookie的SameSite属性
 */

/**
 * @typedef {Object.<string, any>} CookieStore
 */

class CookieManager {
    /**
     * CookieManager 实例
     */
    static instance = null;

    /**
     * cookie 缓存
     */
    #cookieCache = null;
    /**
     * 上次同步时间
     */
    #lastSyncTime = 0;
    /**
     * 同步间隔，单位毫秒
     */
    #syncInterval = 1000;
    /**
     * 默认选项
     */
    #defaultOptions = {
        path: "/",
        domain: location.hostname,
        secure: true,
        sameSite: "None",
    };

    constructor() {
        if (CookieManager.instance) {
            return CookieManager.instance;
        }
        CookieManager.instance = this;
    }

    /**
     * 初始化并缓存所有cookie
     * @param {number} [syncInterval=1000] - 同步间隔，单位毫秒
     */
    setup(syncInterval = 1000) {
        this.#syncInterval = syncInterval;
        this.#syncCookies();
    }

    /**
     * 设置单个cookie
     * @param {string} name - cookie的名称
     * @param {any} value - cookie的值
     * @param {CookieOptions} [options] - cookie的选项
     */
    setCookie(name, value, options = {}) {
        const mergedOptions = { ...this.#defaultOptions, ...options };
        const cookieString = this.#createCookieString(
            name,
            value,
            mergedOptions
        );
        document.cookie = cookieString;

        if (this.#cookieCache) {
            this.#cookieCache[name] = value;
            this.#lastSyncTime = Date.now();
        }
    }

    /**
     * 同时设置多个cookie
     * @param {CookieStore} cookies - 包含cookie名称和值的对象
     * @param {CookieOptions} [options] - 所有cookie的选项
     */
    setCookies(cookies, options = {}) {
        const mergedOptions = { ...this.#defaultOptions, ...options };
        for (const [name, value] of Object.entries(cookies)) {
            this.setCookie(name, value, mergedOptions);
        }
    }

    /**
     * 获取单个cookie
     * @param {string} name - 要获取的cookie的名称
     * @returns {any} cookie的值，如果不存在则返回null
     */
    getCookie(name) {
        this.#checkSync();
        if (this.#cookieCache) {
            return this.#cookieCache[name] || null;
        }
        const cookies = this.#getAllCookies();
        return cookies[name] || null;
    }

    /**
     * 获取所有cookie或指定的多个cookie
     * @param {string[]} [names] - 要获取的cookie名称数组
     * @returns {CookieStore} 包含请求的cookie的对象
     */
    getCookies(names) {
        this.#checkSync();
        const allCookies = this.#cookieCache || this.#getAllCookies();

        if (!names) {
            return allCookies;
        }

        return names.reduce((acc, name) => {
            if (allCookies[name]) {
                acc[name] = allCookies[name];
            }
            return acc;
        }, {});
    }

    /**
     * 删除指定的cookie
     * @param {string | string[]} name - 要删除的cookie的名称
     * @param {CookieOptions} [options] - cookie的选项（用于确保正确的domain和path）
     */
    deleteCookie(name, options = {}) {
        const mergedOptions = {
            ...this.#defaultOptions,
            ...options,
            expires: new Date(0),
        };

        if (Array.isArray(name)) {
            name.forEach((n) => this.deleteCookie(n, mergedOptions));
            return;
        }

        this.setCookie(name, "", mergedOptions);
        if (this.#cookieCache) {
            delete this.#cookieCache[name];
        }
    }

    /**
     * 创建cookie字符串
     * @private
     * @param {string} name - cookie的名称
     * @param {any} value - cookie的值
     * @param {CookieOptions} options - cookie的选项
     * @returns {string} 格式化的cookie字符串
     */
    #createCookieString(name, value, options) {
        let cookieString = `${encodeURIComponent(name)}=${encodeURIComponent(
            typeof value === "string" ? value : JSON.stringify(value)
        )}`;

        if (options.domain) {
            cookieString += `; domain=${options.domain}`;
        }
        if (options.path) {
            cookieString += `; path=${options.path}`;
        }
        if (options.expires) {
            cookieString += `; expires=${options.expires.toUTCString()}`;
        }
        if (options.secure) {
            cookieString += "; secure";
        }
        if (options.sameSite) {
            cookieString += `; samesite=${options.sameSite}`;
        }

        return cookieString;
    }

    /**
     * 获取所有cookie
     * @private
     * @returns {CookieStore} 包含所有cookie的对象
     */
    #getAllCookies() {
        return document.cookie.split("; ").reduce((acc, current) => {
            const [name, value] = current.split("=").map((c) => c.trim());
            if (name) {
                acc[decodeURIComponent(name)] = decodeURIComponent(value);
            }
            return acc;
        }, {});
    }

    /**
     * 检查并在必要时同步cookie
     * @private
     */
    #checkSync() {
        if (
            this.#cookieCache &&
            Date.now() - this.#lastSyncTime > this.#syncInterval
        ) {
            this.#syncCookies();
        }
    }

    /**
     * 同步cookie缓存与document.cookie
     * @private
     */
    #syncCookies() {
        this.#cookieCache = this.#getAllCookies();
        this.#lastSyncTime = Date.now();
    }
}

export const cookieManager = new CookieManager();
