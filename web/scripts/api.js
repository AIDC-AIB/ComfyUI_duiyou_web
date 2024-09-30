
/**
 *
 * @typedef {{
 *  prompt: object;
 *  extra_data: { extra_pnginfo: { workflow } };
 *  client_id: string;
 * 	flow_id: string;
 * 	front?: boolean;
 *  number?: number;
 * }} IPrompt
 *
 * @typedef {{
 * 	state: boolean;
 * 	code: number;
 * 	error: object;
 * 	node_errors: object;
 * 	prompt_id: string;
 * }} IValidatePromptResponse
 *
 * @typedef {{
 * 	prompt_id: string;
 * 	number: number;
 * 	node_errors: object;
 * }} IExecutePromptResponse
 *
 */

import { cookieManager } from "./cookie.js";

class ComfyApi extends EventTarget {
	#registered = new Set();
	/**
	 * user token
	 * @description 外部传入的
	 * @type {string}
	 */
	userToken = '';
	/**
	 * user info
	 *
	 * @typedef {{
	 * 	userId: string
	 * }} IUserInfo
	 *
	 * @type {IUserInfo}
	 */
	userInfo = {};
	/**
	 * current flow id
	 *
	 * @type {string}
	 */
	currentFlowId = null;

	constructor() {
		super();
		this.api_host = location.host;
		this.api_base = location.pathname.split('/').slice(0, -1).join('/');
		this.initialClientId = sessionStorage.getItem("clientId");
	}

	apiURL(route, searchParams) {
		// let route_clientId_list = ["/upload/image", "/upload/mask", "/view", "/prompt", "/history", "/queue", "/free"]
		// let route_clientId_list = ["/upload/image", "/upload/mask", "/view", "/prompt", "/history", "/queue", "/free",'/user','/system_stats','/settings','/extensions']

		const apiURL = new URL(location.origin + this.api_base + route);
		if (!apiURL.searchParams.has('clientId')) {
      // 优先取 this.clientId 和 window.name，因为这两个实时通过 socket 返回的消息拿到的
      // 参见 this.#createSocket 中对 socket 推送的 status 消息类型的逻辑处理
			apiURL.searchParams.set('clientId', this.clientId || window.name || this.initialClientId);
		}

		if (searchParams) {
			for (const [key, value] of searchParams) {
				apiURL.searchParams.set(key, value);
			}
		}

		return apiURL.href;
	}

	fetchApi(route, options) {
		if (!options) {
			options = {};
		}
		if (!options.headers) {
			options.headers = {};
		}

		if (this.userToken && !options.headers["userToken"]) {
			options.headers["userToken"] = this.userToken;
		}

		if (this.userInfo.userId && !options.headers["userId"]) {
			options.headers["userId"] = this.userInfo.userId;
		}

		options.headers["Comfy-User"] = this.user;
		return fetch(this.apiURL(route, options.searchParams), options);
	}

	addEventListener(type, callback, options) {
		super.addEventListener(type, callback, options);
		this.#registered.add(type);
	}

	/**
	 * Poll status  for colab and other things that don't support websockets.
	 */
	#pollQueue() {
		setInterval(async () => {
			try {
				const resp = await this.fetchApi("/prompt");
				const status = await resp.json();
				this.dispatchEvent(new CustomEvent("status", { detail: status }));
			} catch (error) {
				this.dispatchEvent(new CustomEvent("status", { detail: null }));
			}
		}, 1000);
	}

	/**
	 * Creates and connects a WebSocket for realtime updates
	 * @param {boolean} isReconnect If the socket is connection is a reconnect attempt
	 */
	#createSocket(isReconnect) {
		if (this.socket) {
			return;
		}

		let opened = false;
		const socketApiURL = new URL(`${window.location.protocol === "https:" ? "wss" : "ws"}://${this.api_host}${this.api_base}/ws`)

		if (window.name) {
			socketApiURL.searchParams.set("clientId", window.name);
		}
		if (this.userToken) {
			socketApiURL.searchParams.set("userToken", this.userToken);
		}

		// let existingSession = window.name;
		// if (existingSession) {
		// 	existingSession = "?clientId=" + existingSession;
		// }
		// this.socket = new WebSocket(
		// 	`ws${window.location.protocol === "https:" ? "s" : ""}://${this.api_host}${this.api_base}/ws${existingSession}`
		// );
		this.socket = new WebSocket(socketApiURL.href);
		this.socket.binaryType = "arraybuffer";

		this.socket.addEventListener("open", () => {
			opened = true;
			if (isReconnect) {
				this.dispatchEvent(new CustomEvent("reconnected"));
			}
		});

		this.socket.addEventListener("error", () => {
			if (this.socket) this.socket.close();
			if (!isReconnect && !opened) {
				this.#pollQueue();
			}
		});

		this.socket.addEventListener("close", () => {
			setTimeout(() => {
				this.socket = null;
				this.#createSocket(true);
			}, 300);
			if (opened) {
				this.dispatchEvent(new CustomEvent("status", { detail: null }));
				this.dispatchEvent(new CustomEvent("reconnecting"));
			}
		});

		this.socket.addEventListener("message", (event) => {
			try {
				if (event.data instanceof ArrayBuffer) {
					const view = new DataView(event.data);
					const eventType = view.getUint32(0);
					const buffer = event.data.slice(4);
					switch (eventType) {
					case 1:
						const view2 = new DataView(event.data);
						const imageType = view2.getUint32(0)
						let imageMime
						switch (imageType) {
							case 1:
							default:
								imageMime = "image/jpeg";
								break;
							case 2:
								imageMime = "image/png"
						}
						const imageBlob = new Blob([buffer.slice(4)], { type: imageMime });
						this.dispatchEvent(new CustomEvent("b_preview", { detail: imageBlob }));
						break;
					default:
						throw new Error(`Unknown binary websocket message of type ${eventType}`);
					}
				}
				else {
				    const msg = JSON.parse(event.data);
				    switch (msg.type) {
					    case "status":
						    if (msg.data.sid) {
							    this.clientId = msg.data.sid;
							    window.name = this.clientId; // use window name so it isnt reused when duplicating tabs
								sessionStorage.setItem("clientId", this.clientId); // store in session storage so duplicate tab can load correct workflow
						    }
						    this.dispatchEvent(new CustomEvent("status", { detail: msg.data.status }));
						    break;
					    case "progress":
						    this.dispatchEvent(new CustomEvent("progress", { detail: msg.data }));
						    break;
					    case "executing":
						    this.dispatchEvent(new CustomEvent("executing", { detail: msg.data }));
						    break;
					    case "executed":
						    this.dispatchEvent(new CustomEvent("executed", { detail: msg.data }));
						    break;
					    case "execution_start":
						    this.dispatchEvent(new CustomEvent("execution_start", { detail: msg.data }));
						    break;
					    case "execution_error":
						    this.dispatchEvent(new CustomEvent("execution_error", { detail: msg.data }));
						    break;
					    case "execution_cached":
						    this.dispatchEvent(new CustomEvent("execution_cached", { detail: msg.data }));
						    break;
              // extra case
              case "execution_untracked":
                /**
                 * 流程执行成功，但结果未被正确记录到第三方后端
                 *
                 * @type {import('../types/app.js').ExecutionUntrackedWebSocketMessageEvent} 返回的消息内容
                 */
                this.dispatchEvent(new CustomEvent("execution_untracked", { detail: msg.data }));
						    break;
              // extra case
              case "execution_finished":
                /**
                 * 流程执行成功，结果正确记录到第三方后端
                 *
                 * @type {import('../types/app.js').ExecutionFinishedWebSocketMessageEvent} 返回的消息内容
                 */
                this.dispatchEvent(new CustomEvent("execution_finished", { detail: msg.data }));
						    break;
					    default:
						    if (this.#registered.has(msg.type)) {
							    this.dispatchEvent(new CustomEvent(msg.type, { detail: msg.data }));
						    } else {
							    throw new Error(`Unknown message type ${msg.type}`);
						    }
				    }
				}
			} catch (error) {
				console.warn("Unhandled message:", event.data, error);
			}
		});
	}

	/**
	 * Initialises sockets and realtime updates
	 */
	init() {
		this.#createSocket();
	}

	/**
	 * Gets a list of extension urls
	 * @returns An array of script urls to import
	 */
	async getExtensions() {
		const resp = await this.fetchApi("/extensions", { cache: "no-store" });
		return await resp.json();
	}

	/**
	 * Gets a list of embedding names
	 * @returns An array of script urls to import
	 */
	async getEmbeddings() {
		const resp = await this.fetchApi("/embeddings", { cache: "no-store" });
		return await resp.json();
	}

	/**
	 * Loads node object definitions for the graph
	 * @returns The node definitions
	 */
	async getNodeDefs() {
		const resp = await this.fetchApi("/object_info", { cache: "no-store" });
		const data = await resp.json();
		// 把接口返回的 CheckpointLoaderSimple 节点数据过滤掉
		if (data.CheckpointLoaderSimple && data.CheckpointLoaderSimple.input && data.CheckpointLoaderSimple.input.required && data.CheckpointLoaderSimple.input.required.ckpt_name) {
			data.CheckpointLoaderSimple.input.required.ckpt_name = [[]]
		}

		return data
	}

	/**
	 * 此函数改造为仅校验 workflow 的能力，不做执行逻辑
	 *
	 * @param {number} number The index at which to queue the prompt, passing -1 will insert the prompt at the front of the queue
	 * @param {{
	 * 	output: IPrompt['prompt'];
	 * 	workflow: IPrompt['extra_data']['extra_pnginfo']['workflow'];
	 * }} prompt The prompt data to queue
	 */
	async queuePrompt(number, { output, workflow }) {
		// 此处需要小心
		// 之所以复用api.queuePrompt是因为第三方插件和节点会对api.queuePrompt做修改，同时会把我们自定义传入的参数弄丢
		// 所以我们要想外面传入flow_id，只能将其挂到this上 => `this.currentFlowId`
		// 当执行结束后，外部会将`this.currentFlowId`置空
		// 函数内，只负责消费，不负责处理
		/** @type {IPrompt} */
		const body = {
			flow_id: this.currentFlowId,
			client_id: this.clientId,
			prompt: output,
			extra_data: { extra_pnginfo: { workflow } },
		};

		if (number === -1) {
			body.front = true;
		} else if (number != 0) {
			body.number = number;
		}

		// 校验 workflow 数据是否正确
		const { prompt_id, ...restResp } = await this.validatePrompt(body);

		// 没有 prompt_id，说明校验失败
		if (!prompt_id) {
			throw new Error('workflow validation failed!');
		}

		return {
			prompt_id,
      // 执行进度需要节点信息
      // 从接口 /queue 拿有延迟
      nodeIds: Object.keys(output),
			...restResp
		}
	}

	/**
	 * Validates a prompt
	 *
	 * @param {IPrompt} payload
	 * @returns {Promise<IValidatePromptResponse>}
	 */
	async validatePrompt(payload) {
		const resp = await this.fetchApi("/validate_prompt", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify(payload),
		});

		/** @type {IValidatePromptResponse & { node_error: object }} */
		let { node_error, run_id, ...respJson } = await resp.json();
		respJson = {
			...respJson,
			prompt_id: run_id,
			node_errors: node_error,
		}

		if (respJson.code === 1001) {
			throw new Error(respJson.error || 'not found workflow data');
		}

		if (respJson.code === 1002) {
			throw new Error(respJson.error);
		}

		// workflow 校验没通过，抛出 ValidateError
		if (respJson.code === 1003) {
			throw {
				response: respJson,
			};
		}

		// 当接口返回的http状态码不为200，或者返回的code不为0，则抛出错误
		if (resp.status !== 200 || respJson.code !== 0) {
			throw respJson;
		}

		return respJson;
	}

	/**
	 * Executes a prompt
	 *
	 * @param {string} prompd_id The prompd_id of the prompt
	 * @returns {Promise<IExecutePromptResponse>}
	 */
	async executePrompt(prompd_id) {
		const resp = await this.fetchApi(`/execute/${prompd_id}`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
		});

		// 对接口返回的 node_error 字段进行处理，保持和 comfyui 原生内部的字段名称一致
		let { node_error, ...respJson } = await resp.json();
		respJson = {
			...respJson,
			node_errors: node_error,
		}

		if (resp.status !== 200) {
			throw {
				response: respJson,
			};
		}

		return respJson;
	}

	/**
	 * Loads a list of items (queue or history)
	 * @param {string} type The type of items to load, queue or history
	 * @returns The items of the specified type grouped by their status
	 */
	async getItems(type) {
		if (type === "queue") {
			return this.getQueue();
		}
		return this.getHistory();
	}

	/**
	 * Gets the current state of the queue
	 * @returns The currently running and queued items
	 */
	async getQueue() {
		try {
			const res = await this.fetchApi("/queue");
			const data = await res.json();
			return {
				// Running action uses a different endpoint for cancelling
				Running: data.queue_running.map((prompt) => ({
					prompt,
					remove: { name: "Cancel", cb: () => api.interrupt() },
				})),
				Pending: data.queue_pending.map((prompt) => ({ prompt })),
			};
		} catch (error) {
			console.error(error);
			return { Running: [], Pending: [] };
		}
	}

	/**
	 * Gets the prompt execution history
	 * @returns Prompt history including node outputs
	 */
	async getHistory(max_items=200) {
		try {
			const res = await this.fetchApi(`/history?max_items=${max_items}`);
			return { History: Object.values(await res.json()) };
		} catch (error) {
			console.error(error);
			return { History: [] };
		}
	}

	/**
	 * Gets system & device stats
	 * @returns System stats such as python version, OS, per device info
	 */
	async getSystemStats() {
		const res = await this.fetchApi("/system_stats");
		return await res.json();
	}

	/**
	 * Sends a POST request to the API
	 * @param {*} type The endpoint to post to
	 * @param {*} body Optional POST data
	 */
	async #postItem(type, body) {
		try {
			await this.fetchApi("/" + type, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: body ? JSON.stringify(body) : undefined,
			});
		} catch (error) {
			console.error(error);
		}
	}

	/**
	 * Deletes an item from the specified list
	 * @param {string} type The type of item to delete, queue or history
	 * @param {number} id The id of the item to delete
	 */
	async deleteItem(type, id) {
		await this.#postItem(type, { delete: [id] });
	}

	/**
	 * Clears the specified list
	 * @param {string} type The type of list to clear, queue or history
	 */
	async clearItems(type) {
		await this.#postItem(type, { clear: true });
	}

	/**
	 * Interrupts the execution of the running prompt
	 */
	async interrupt() {
		await this.#postItem("interrupt", null);
	}

	/**
	 * Gets user configuration data and where data should be stored
	 * @returns { Promise<{ storage: "server" | "browser", users?: Promise<string, unknown>, migrated?: boolean }> }
	 */
	async getUserConfig() {
		return (await this.fetchApi("/users")).json();
	}

	/**
	 * Creates a new user
	 * @param { string } username
	 * @returns The fetch response
	 */
	createUser(username) {
		return this.fetchApi("/users", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ username }),
		});
	}

	/**
	 * Gets all setting values for the current user
	 * @returns { Promise<string, unknown> } A dictionary of id -> value
	 */
	async getSettings() {
		return (await this.fetchApi("/settings")).json();
	}

	/**
	 * Gets a setting for the current user
	 * @param { string } id The id of the setting to fetch
	 * @returns { Promise<unknown> } The setting value
	 */
	async getSetting(id) {
		return (await this.fetchApi(`/settings/${encodeURIComponent(id)}`)).json();
	}

	/**
	 * Stores a dictionary of settings for the current user
	 * @param { Record<string, unknown> } settings Dictionary of setting id -> value to save
	 * @returns { Promise<void> }
	 */
	async storeSettings(settings) {
		return this.fetchApi(`/settings`, {
			method: "POST",
			body: JSON.stringify(settings)
		});
	}

	/**
	 * Stores a setting for the current user
	 * @param { string } id The id of the setting to update
	 * @param { unknown } value The value of the setting
	 * @returns { Promise<void> }
	 */
	async storeSetting(id, value) {
		return this.fetchApi(`/settings/${encodeURIComponent(id)}`, {
			method: "POST",
			body: JSON.stringify(value)
		});
	}

	/**
	 * Gets a user data file for the current user
	 * @param { string } file The name of the userdata file to load
	 * @param { RequestInit } [options]
	 * @returns { Promise<unknown> } The fetch response object
	 */
	async getUserData(file, options) {
		return this.fetchApi(`/userdata/${encodeURIComponent(file)}`, options);
	}

	/**
	 * Stores a user data file for the current user
	 * @param { string } file The name of the userdata file to save
	 * @param { unknown } data The data to save to the file
	 * @param { RequestInit & { stringify?: boolean, throwOnError?: boolean } } [options]
	 * @returns { Promise<void> }
	 */
	async storeUserData(file, data, options = { stringify: true, throwOnError: true }) {
		const resp = await this.fetchApi(`/userdata/${encodeURIComponent(file)}`, {
			method: "POST",
			body: options?.stringify ? JSON.stringify(data) : data,
			...options,
		});
		if (resp.status !== 200) {
			throw new Error(`Error storing user data file '${file}': ${resp.status} ${(await resp).statusText}`);
		}
	}

	/**
	 * Authenticates the current user
	 * @param { string } userToken The user token to authenticate with
	 * @returns { Promise<IUserInfo> }
	 */
	async authenticate(userToken) {
		this.userToken = userToken;

		const resp = await this.fetchApi("/authenticate", {
			method: "GET",
		});

		if (resp.status === 401) {
			throw new Error("Invalid user token");
		}

		if (resp.status !== 200) {
			throw new Error(`Error authenticating user: ${resp.status} ${resp.statusText}`);
		}

		this.userInfo = await resp.json();

        cookieManager.setCookies({
            userToken: this.userToken,
            userId: this.userInfo.userId,
        })

		/**
		 * 鉴权接口需要在初始化最早执行，鉴权通过才可往下执行,
		 * 这里同时使用鉴权接口返回的clientId信息赋值给window.name，为了分布式后端根据clientId做Hash一致性使用，避免creatSocket未填入clientId导致未能与后面的请求形成hash一致
		*/
		if (!window.name) {
			window.name = this.userInfo.clientId
		}

		return this.userInfo;
	}
}

export const api = new ComfyApi();
