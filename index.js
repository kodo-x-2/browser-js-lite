class UserFlux {
	static defaultInstance = null

	constructor(apiKey, options) {
		this.ufApiKey = null
		this.ufUserId = null
		this.ufExternalId = null
		this.ufTrackQueue = []
		this.ufAnonymousId = ""
		this.ufSessionId = null
		this.ufAllowCookies = false
		this.ufCookieSameSiteSetting = "Strict"
		this.ufLocationEnrichmentEnabled = true
		this.ufDeviceDataEnrichmentEnabled = true
		this.ufDefaultTrackingProperties = {}
		this.ufCustomQueryParamsToCollect = []
		this.ufDisableUserIdStorage = false
		this.ufCookieExpiryDays = 365
		this.ufConsecutiveFailures = 0
		this.ufMaxConsecutiveFailures = 3
		this.ufRetryDelay = 1000 // 1 second delay between retries
		this.ufEndpoint = "https://integration-api.userflux.co"
		this.ufStorageKeyPrefix = ""
		this.ufFlushIntervalId = null

		if (apiKey !== undefined) {
			this.initialize(apiKey, options)
		}
	}

	static getDefaultInstance() {
		if (!UserFlux.defaultInstance) {
			UserFlux.defaultInstance = new UserFlux()
		}

		return UserFlux.defaultInstance
	}

	static createInstance(apiKey, options) {
		return new UserFlux(apiKey, options)
	}

	static initialize(apiKey, options) {
		UserFlux.getDefaultInstance().initialize(apiKey, options)
	}

	static updateDefaultTrackingProperties(properties) {
		UserFlux.getDefaultInstance().updateDefaultTrackingProperties(properties)
	}

	static async identify(parameters) {
		return await UserFlux.getDefaultInstance().identify(parameters)
	}

	static async track(parameters) {
		return await UserFlux.getDefaultInstance().track(parameters)
	}

	static async trackBatch(events) {
		return await UserFlux.getDefaultInstance().trackBatch(events)
	}

	static async reset() {
		return await UserFlux.getDefaultInstance().reset()
	}

	static getUserId() {
		return UserFlux.getDefaultInstance().getUserId()
	}

	static getAnonymousId() {
		return UserFlux.getDefaultInstance().getAnonymousId()
	}

	static getSessionId() {
		return UserFlux.getDefaultInstance().getSessionId()
	}

	static async flush() {
		return await UserFlux.getDefaultInstance().flush()
	}

	static async trackPageView() {
		return await UserFlux.getDefaultInstance().trackPageView()
	}

	initialize(apiKey, options) {
		try {
			const safeOptions = options && typeof options === "object" ? options : {}
			const shouldDisableCommonBotsBlocking =
				"blockCommonBots" in safeOptions && safeOptions["blockCommonBots"] == false
			if (!shouldDisableCommonBotsBlocking && UserFlux.isBotUserAgent(window.navigator.userAgent)) {
				console.info("Common bot detected. UserFlux SDK will not initialize.")
				return
			}

			this.ufApiKey = apiKey

			this.ufStorageKeyPrefix =
				"storageKeyPrefix" in safeOptions
					? UserFlux.normalizeStorageKeyPrefix(safeOptions["storageKeyPrefix"])
					: ""

			if ("endpoint" in safeOptions && typeof safeOptions["endpoint"] === "string") {
				this.ufEndpoint = safeOptions["endpoint"]
			}

			if ("allowCookies" in safeOptions && safeOptions["allowCookies"] == true) {
				this.ufAllowCookies = true
			}

			if ("cookieSameSiteSetting" in safeOptions && safeOptions["cookieSameSiteSetting"] == "Lax") {
				this.ufCookieSameSiteSetting = "Lax"
			}

			if ("cookieExpiryDays" in safeOptions && typeof safeOptions["cookieExpiryDays"] === "number") {
				this.ufCookieExpiryDays = safeOptions["cookieExpiryDays"]
			}

			if ("disableUserIdStorage" in safeOptions && safeOptions["disableUserIdStorage"] == true) {
				this.ufDisableUserIdStorage = true
			}

			let anonymousIdOverride = null
			if ("anonymousIdOverride" in safeOptions && typeof safeOptions["anonymousIdOverride"] === "string") {
				anonymousIdOverride = safeOptions["anonymousIdOverride"]
			}

			this.ufAnonymousId = this.getOrCreateAnonymousId(anonymousIdOverride)
			this.ufUserId = this.getUserId()
			this.ufTrackQueue = this.loadEventsFromStorage()

			if (!("trackSession" in safeOptions && safeOptions["trackSession"] == false)) {
				this.setupSessionId()
			}

			if ("autoEnrich" in safeOptions && safeOptions["autoEnrich"] == false) {
				this.ufLocationEnrichmentEnabled = false
				this.ufDeviceDataEnrichmentEnabled = false
			}

			if ("defaultTrackingProperties" in safeOptions && typeof safeOptions["defaultTrackingProperties"] === "object") {
				this.ufDefaultTrackingProperties = safeOptions["defaultTrackingProperties"]
			}

			if (
				"customQueryParamsToCollect" in safeOptions &&
				Array.isArray(safeOptions["customQueryParamsToCollect"]) === true
			) {
				this.ufCustomQueryParamsToCollect = safeOptions["customQueryParamsToCollect"]
			}

			this.startFlushInterval()

			if ("autoCapture" in safeOptions) {
				this.setupAutoTracking(safeOptions["autoCapture"])
			}

			if (this.ufDisableUserIdStorage == true && this.ufUserId != null) {
				this.getStorage()?.removeItem("uf-userId")
			}
		} catch (error) {
			console.info("Failed to initialize UserFlux SDK: ", error)
		}
	}

	updateDefaultTrackingProperties(properties) {
		if (typeof properties !== "object") {
			console.info("UF defaultTrackingProperties must be an object.")
			return
		}

		this.ufDefaultTrackingProperties = properties
	}

	static normalizeStorageKeyPrefix(prefix) {
		if (typeof prefix !== "string") {
			return ""
		}

		const normalized = prefix.trim().replace(/-+$/, "")
		if (normalized === "") {
			return ""
		}

		if (!/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(normalized)) {
			console.info("UF storageKeyPrefix contains invalid characters and will be ignored.")
			return ""
		}

		return normalized
	}

	getStorageKey(key) {
		return this.ufStorageKeyPrefix ? `${this.ufStorageKeyPrefix}-${key}` : key
	}

	getStorage() {
		if (typeof window === "undefined") {
			return null
		}

		return {
			setItem: (key, value) => {
				try {
					const storageKey = this.getStorageKey(key)
					let shouldSkipForLocalStorage = this.ufDisableUserIdStorage == true && key === "uf-userId"
					if (!shouldSkipForLocalStorage && this.isLocalStorageAccessible())
						localStorage.setItem(storageKey, value)

					let shouldSkipForCookieStorage = key == "uf-track"
					if (this.ufAllowCookies == true && !shouldSkipForCookieStorage)
						this.setCookie(key, value, this.ufCookieExpiryDays)
				} catch (error) {
					console.info("Error setting item to storage: ", error)
				}
			},
			getItem: (key) => {
				try {
					const storageKey = this.getStorageKey(key)
					// first try fetch from cookies
					const cookieValue = (this.ufAllowCookies == true ? this.getCookie(key) : null)
					if (cookieValue !== null && cookieValue !== "") return cookieValue

					// then try fetch from localStorage
					const localStorageValue = (this.isLocalStorageAccessible() ? localStorage.getItem(storageKey) : null)
					if (localStorageValue !== null && localStorageValue !== "") return localStorageValue

					// if not found in cookies or localStorage, return null
					return null
				} catch (error) {
					console.info("Error getting item from storage: ", error)
					return null
				}
			},
			removeItem: (key) => {
				try {
					const storageKey = this.getStorageKey(key)
					if (this.ufAllowCookies == true) this.eraseCookie(key)
					if (this.isLocalStorageAccessible()) localStorage.removeItem(storageKey)
				} catch (error) {
					console.info("Error removing item from storage: ", error)
				}
			},
		}
	}

	getSessionStorage() {
		if (typeof window === "undefined" || !this.isSessionStorageAccessible()) {
			return null
		}

		return {
			setItem: (key, value) => {
				try {
					sessionStorage.setItem(this.getStorageKey(key), value)
				} catch (error) {
					console.info("Error setting item to session storage: ", error)
				}
			},
			getItem: (key) => {
				try {
					return sessionStorage.getItem(this.getStorageKey(key))
				} catch (error) {
					console.info("Error getting item from session storage: ", error)
					return null
				}
			},
			removeItem: (key) => {
				try {
					sessionStorage.removeItem(this.getStorageKey(key))
				} catch (error) {
					console.info("Error removing item from session storage: ", error)
				}
			},
		}
	}

	setupSessionId() {
		try {
			if (!this.isSessionStorageAccessible()) {
				console.info("Session storage is not accessible. Session ID handling will be disabled.")
				this.clearSessionId()
				return
			}

			const currentSessionId = this.getSessionId()

			if (UserFlux.isStringNullOrBlank(currentSessionId)) {
				const newSessionId = UserFlux.generateUUID()
				this.setSessionId(newSessionId)
			}
		} catch (error) {
			console.info("Error setting up session ID: ", error)
		}
	}

	setSessionId(newSessionId) {
		if (!this.isSessionStorageAccessible()) {
			return
		}

		try {
			this.ufSessionId = newSessionId
			this.getSessionStorage()?.setItem("uf-sessionId", newSessionId)
			if (this.ufAllowCookies == true) this.setCookie("uf-sessionId", newSessionId, 0.003) // 5 minutes in days
		} catch (error) {
			console.info("Error setting session ID: ", error)
		}
	}

	getSessionId() {
		try {
			if (!this.isSessionStorageAccessible()) {
				return null
			}

			// fetch from memory
			if (!UserFlux.isStringNullOrBlank(this.ufSessionId)) {
				this.setSessionId(this.ufSessionId) // replenish storage
				return this.ufSessionId
			}

			// fetch from sesionStorage
			const idFromSessionStorage = this.getSessionStorage()?.getItem("uf-sessionId")
			if (!UserFlux.isStringNullOrBlank(idFromSessionStorage)) {
				this.setSessionId(idFromSessionStorage) // replenish storage
				return idFromSessionStorage
			}

			// fetch from cookie
			const idFromCookie = this.ufAllowCookies == true ? this.getCookie("uf-sessionId") : null
			if (!UserFlux.isStringNullOrBlank(idFromCookie)) {
				this.setSessionId(idFromCookie) // replenish storage
				return idFromCookie
			}

			// otherwise return null
			return null
		} catch (error) {
			console.info("Error getting session ID: ", error)
			return null
		}
	}

	clearSessionId() {
		this.ufSessionId = null
	}

	setupAutoTracking(autoCaptureOptions) {
		if (typeof autoCaptureOptions !== "object") {
			// The typeof operator returns " object " for arrays because in JavaScript arrays are objects.
			console.info("UF autoCapture must be an array.")
			return
		}

		if (autoCaptureOptions.includes("page_views") || autoCaptureOptions.includes("all")) {
			this.setupPageViewListener()
		}

		if (autoCaptureOptions.includes("page_leaves") || autoCaptureOptions.includes("all")) {
			this.setupPageLeaveListener()
		}

		if (autoCaptureOptions.includes("clicks") || autoCaptureOptions.includes("all")) {
			this.setupClickListener()
		}
	}

	setupPageViewListener() {
		// Check if running in a browser environment
		if (typeof window === "undefined") {
			return
		}

		window.addEventListener("pageshow", async (event) => {
			await this.trackPageView()
		})
	}

	setupPageLeaveListener() {
		// Check if running in a browser environment
		if (typeof window === "undefined") {
			return
		}

		// TBD: what's best to use pagehide or beforeunload
		window.addEventListener("pagehide", async (event) => {
			await this.trackPageLeave()
		})
	}

	async trackPageView() {
		await this.track({
			event: "page_view",
			properties: {
				...UserFlux.getPageProperties(),
				...(UserFlux.getReferrerProperties() || {}),
				...(UserFlux.getUTMProperties() || {}),
				...(UserFlux.getPaidAdProperties() || {}),
			},
			addToQueue: false,
		})
	}

	setupClickListener() {
		// Check if running in a browser environment
		if (typeof window === "undefined") {
			return
		}

		document.addEventListener("click", async (event) => {
			const element = event.target.closest('a, button, input[type="submit"], input[type="button"]')

			// If the clicked element or its parent is not what we want to track, return early.
			if (!element) return

			await this.trackClick(element)
		})
	}

	async trackClick(element) {
		const properties = {
			elementTagName: element.tagName,
			elementInnerText:
				element.innerText && element.innerText.length < 200 ? element.innerText.trim() : undefined,
			elementId: element.id && element.id !== "" ? element.id : undefined,
			...UserFlux.getPageProperties(),
		}

		// Filter out properties that are undefined
		const filteredProperties = Object.keys(properties).reduce((obj, key) => {
			if (properties[key] !== undefined) {
				obj[key] = properties[key]
			}
			return obj
		}, {})

		await this.track({
			event: "click",
			properties: {
				...filteredProperties,
			},
			addToQueue: true,
		})
	}

	async trackPageLeave() {
		await this.track({
			event: "page_leave",
			properties: {
				...UserFlux.getPageProperties(),
				...(UserFlux.getReferrerProperties() || {}),
				...(UserFlux.getUTMProperties() || {}),
				...(UserFlux.getPaidAdProperties() || {}),
			},
			addToQueue: true,
		})
	}

	isApiKeyProvided() {
		return this.ufApiKey !== null
	}

	getOrCreateAnonymousId(override) {
		if (override) {
			// Update anonymousId in memory + local + cookie storage to prevent it from expiring
			this.ufAnonymousId = override
			this.getStorage()?.setItem("uf-anonymousId", override)

			return override
		}

		let anonymousId
		if (UserFlux.isStringNullOrBlank(this.ufAnonymousId)) {
			// default value is '' which means it hasn't been set yet
			// fetch from storage, if it isn't there then create a new ID
			anonymousId = this.getStorage()?.getItem("uf-anonymousId") ?? UserFlux.createNewAnonymousId()
		} else {
			// otherwise value is set
			anonymousId = this.ufAnonymousId
		}

		// Update anonymousId in memory + local + cookie storage to prevent it from expiring
		this.ufAnonymousId = anonymousId
		this.getStorage()?.setItem("uf-anonymousId", anonymousId)

		return anonymousId
	}

	static createNewAnonymousId() {
		return UserFlux.generateUUID()
	}

	static generateUUID() {
		return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
			let r = (Math.random() * 16) | 0,
				v = c == "x" ? r : (r & 0x3) | 0x8
			return v.toString(16)
		})
	}

	getUserId() {
		let userId = this.ufUserId || this.getStorage()?.getItem("uf-userId")

		// clean up any wrongly stored user ids
		let shouldForceUpdate = false

		// handle edge case values
		if (UserFlux.isStringNullOrBlank(userId)) {
			userId = null
			shouldForceUpdate = true
		}

		if (userId || shouldForceUpdate) {
			// Update userId in local storage to prevent it from expiring
			this.getStorage()?.setItem("uf-userId", userId)
		}

		return userId
	}

	getAnonymousId() {
		return this.getOrCreateAnonymousId()
	}

	setUserId(userId) {
		this.ufUserId = userId
		this.getStorage()?.setItem("uf-userId", userId)
	}

	setExternalId(externalId) {
		this.ufExternalId = externalId
		this.getStorage()?.setItem("uf-externalId", externalId)
	}

	loadEventsFromStorage() {
		try {
			const events = this.getStorage()?.getItem("uf-track")
			return events ? JSON.parse(events) : []
		} catch (error) {
			console.info("Failed to get tracking events from storage: ", error)
			this.getStorage()?.removeItem("uf-track")
			return []
		}
	}

	async reset() {
		// Firstly, flush any pending events
		await this.checkQueue(this.ufTrackQueue, "event/ingest/batch", true)

		// Clear all stored data
		this.ufUserId = null
		this.getStorage()?.removeItem("uf-userId")

		this.ufExternalId = null
		this.getStorage()?.removeItem("uf-externalId")
	}

	startFlushInterval() {
		if (this.ufFlushIntervalId !== null) {
			clearInterval(this.ufFlushIntervalId)
		}

		this.ufFlushIntervalId = setInterval(async () => {
			await this.checkQueue(this.ufTrackQueue, "event/ingest/batch", true)
		}, 1500)
	}

	async identify(parameters) {
		// sanity check API key
		if (!this.isApiKeyProvided()) {
			console.info("API key not provided. Cannot identify user.")
			return
		}

		// sanity check parameters
		if (!parameters || typeof parameters !== "object") {
			console.info("Invalid parameters passed to track method")
			return
		}

		// sanity check userId
		let userId = parameters.userId || this.ufUserId
		if (userId && (typeof userId !== "string" || UserFlux.isStringNullOrBlank(userId))) userId = null
		if (userId !== this.ufUserId) this.setUserId(userId)

		// sanity check externalId
		let externalId = parameters.externalId || this.ufExternalId || UserFlux.getExternalIdQueryParam()
		if (externalId && (typeof externalId !== "string" || UserFlux.isStringNullOrBlank(externalId))) externalId = null
		if (externalId !== this.ufExternalId) this.setExternalId(externalId)

		// sanity check properties
		const properties = parameters.properties || {}
		if (typeof properties !== "object") {
			console.info("Invalid properties passed to identify method")
			return
		}

		// sanity check enrichDeviceData
		const enrichDeviceData = parameters.enrichDeviceData || this.ufDeviceDataEnrichmentEnabled
		if (typeof enrichDeviceData !== "boolean") {
			console.info("Invalid enrichDeviceData passed to identify method")
			return
		}

		// sanity check enrichLocationData
		const enrichLocationData = parameters.enrichLocationData || this.ufLocationEnrichmentEnabled
		if (typeof enrichLocationData !== "boolean") {
			console.info("Invalid enrichLocationData passed to identify method")
			return
		}

		const payload = {
			userId: userId,
			externalId: externalId,
			anonymousId: this.getOrCreateAnonymousId(),
			properties: properties,
			deviceData: enrichDeviceData ? UserFlux.getDeviceProperties() : null,
		}

		return await this.sendRequest("profile", payload, enrichLocationData)
	}

	async track(parameters) {
		// sanity check API key
		if (!this.isApiKeyProvided()) {
			console.info("API key not provided. Cannot track event.")
			return
		}

		// sanity check parameters
		if (!parameters || typeof parameters !== "object") {
			console.info("Invalid parameters passed to track method")
			return
		}

		// sanity check event
		const event = parameters.event
		if (!event || typeof event !== "string" || UserFlux.isStringNullOrBlank(event)) {
			console.info("Invalid event passed to track method")
			return
		}

		// sanity check userId
		let userId = parameters.userId || this.ufUserId
		if (userId && (typeof userId !== "string" || UserFlux.isStringNullOrBlank(userId))) userId = null
		if (userId !== this.ufUserId) this.setUserId(userId)

		// sanity check externalId
		let externalId = parameters.externalId || this.ufExternalId || UserFlux.getExternalIdQueryParam()
		if (externalId && (typeof externalId !== "string" || UserFlux.isStringNullOrBlank(externalId))) externalId = null
		if (externalId !== this.ufExternalId) this.setExternalId(externalId)

		// sanity check properties
		const properties = parameters.properties || {}
		if (typeof properties !== "object") {
			console.info("Invalid properties passed to track method")
			return
		}

		// sanity check enrichDeviceData
		const enrichDeviceData = parameters.enrichDeviceData || this.ufDeviceDataEnrichmentEnabled
		if (typeof enrichDeviceData !== "boolean") {
			console.info("Invalid enrichDeviceData passed to track method")
			return
		}

		// sanity check enrichLocationData
		const enrichLocationData = parameters.enrichLocationData || this.ufLocationEnrichmentEnabled
		if (typeof enrichLocationData !== "boolean") {
			console.info("Invalid enrichLocationData passed to track method")
			return
		}

		const enrichPageProperties = parameters.enrichPageProperties || true
		if (typeof enrichPageProperties !== "boolean") {
			console.info("Invalid enrichPageProperties passed to track method")
			return
		}

		const enrichReferrerProperties = parameters.enrichReferrerProperties || true
		if (typeof enrichReferrerProperties !== "boolean") {
			console.info("Invalid enrichReferrerProperties passed to track method")
			return
		}

		const enrichUTMProperties = parameters.enrichUTMProperties || true
		if (typeof enrichUTMProperties !== "boolean") {
			console.info("Invalid enrichUTMProperties passed to track method")
			return
		}

		const enrichPaidAdProperties = parameters.enrichPaidAdProperties || true
		if (typeof enrichPaidAdProperties !== "boolean") {
			console.info("Invalid enrichPaidAdProperties passed to track method")
			return
		}

		// sanity check addToQueue
		const addToQueue = parameters.addToQueue || false
		if (typeof addToQueue !== "boolean") {
			console.info("Invalid addToQueue passed to track method")
			return
		}

		// combine event properties with any default tracking properties
		const finalProperties = {
			...properties,
			...this.ufDefaultTrackingProperties,
			...(enrichPageProperties ? UserFlux.getPageProperties() : {}),
			...(enrichReferrerProperties ? UserFlux.getReferrerProperties() : {}),
			...(enrichUTMProperties ? UserFlux.getUTMProperties() : {}),
			...(enrichPaidAdProperties ? UserFlux.getPaidAdProperties() : {}),
			...(this.getCustomQueryParamProperties() || {}),
		}

		const payload = {
			timestamp: Date.now(),
			userId: userId,
			externalId: externalId,
			anonymousId: this.getOrCreateAnonymousId(),
			sessionId: this.getSessionId(),
			name: event,
			properties: finalProperties,
			deviceData: enrichDeviceData ? UserFlux.getDeviceProperties() : null,
		}

		const shouldForceFlush = this.getStorage() == null || addToQueue == false
		this.ufTrackQueue.push(payload)
		this.saveEventsToStorage("uf-track", this.ufTrackQueue)
		await this.checkQueue(this.ufTrackQueue, "event/ingest/batch", shouldForceFlush)
		return null
	}

	async trackBatch(events) {
		for (const event of events) {
			await this.track({ ...event, addToQueue: true })
		}

		await this.flush()
		return
	}

	async flush() {
		await this.checkQueue(this.ufTrackQueue, "event/ingest/batch", true)
	}

	saveEventsToStorage(key, queue) {
		this.getStorage()?.setItem(key, JSON.stringify(queue))
	}

	async checkQueue(queue, eventType, forceFlush) {
		if (queue.length >= 10 || (forceFlush && queue.length > 0)) {
			await this.flushEvents(queue, eventType)
		}
	}

	async flushEvents(queue, eventType) {
		if (!this.isApiKeyProvided()) {
			console.info("API key not provided. Cannot flush events.")
			return
		}

		// Check if we've hit the maximum consecutive failures
		if (this.ufConsecutiveFailures >= this.ufMaxConsecutiveFailures) {
			console.info(`UF: Max consecutive failures (${this.ufMaxConsecutiveFailures}) reached. Stopping flush attempts.`)
			// Reset the failure counter after some time to allow retrying later
			setTimeout(() => {
				this.ufConsecutiveFailures = 0
			}, 60000) // Reset after 1 minute
			return
		}

		const eventsToTrack = queue.splice(0, 10)
		const success = await this.sendRequest(eventType, { events: eventsToTrack })
		if (success) {
			this.saveEventsToStorage(`uf-track`, queue)
			this.ufConsecutiveFailures = 0
		} else {
			// If the request fails, add the events back to the queue
			queue.push(...eventsToTrack)
			this.saveEventsToStorage(`uf-track`, queue)
			this.ufConsecutiveFailures++
		}

		// If the queue is not empty, check it again with a delay
		if (queue.length > 0) {
			setTimeout(async () => {
				await this.checkQueue(queue, eventType, true)
			}, this.ufRetryDelay)
		}
	}

	async sendRequest(endpoint, data, locationEnrich = this.ufLocationEnrichmentEnabled) {
		if (!this.isApiKeyProvided()) {
			console.info("API key not provided. Cannot send request.")
			return false
		}

		// Check if we're in an iframe that might be closing/closed
		if (typeof window !== 'undefined' && window.frameElement && !document.body) {
			console.info("UF: Iframe appears to be closing/closed. Skipping request.")
			return false
		}

		try {
			await fetch(`${this.ufEndpoint}/${endpoint}?locationEnrichment=${locationEnrich}`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${this.ufApiKey}`,
				},
				body: JSON.stringify(data),
				keepalive: true,
			})

			return true
		} catch (error) {
			console.info("UF HTTP Error: ", error)
			return false
		}
	}

	static getPageProperties() {
		try {
			// Check if running in a browser environment
			if (typeof window === "undefined") {
				return {}
			}

			return UserFlux.removeNullProperties({
				host: window.location.host,
				href: window.location.href,
				path: window.location.pathname,
				pageTitle: document.title,
			})
		} catch (error) {
			console.info("Error on getPageProperties:", error)
			return {}
		}
	}

	static getDeviceProperties() {
		try {
			// Check if running in a browser environment
			if (typeof window === "undefined") {
				return null
			}

			const userAgent = window.navigator.userAgent
			let browser, browserVersion, deviceType, os

			// Determine Browser and Browser Version
			if (userAgent.indexOf("Chrome") > -1) {
				browser = "Chrome"
				const match = userAgent.match(/Chrome\/(\d+)/)
				browserVersion = match ? match[1] : "Unknown"
			} else if (userAgent.indexOf("CriOS") > -1) {
				browser = "Chrome"
				const match = userAgent.match(/CriOS\/([\d.]+)/)
				browserVersion = match ? match[1] : "Unknown"
			} else if (userAgent.indexOf("Safari") > -1) {
				browser = "Safari"
				const match = userAgent.match(/Version\/([\d.]+)/)
				browserVersion = match ? match[1] : "Unknown"
			} else if (userAgent.indexOf("Firefox") > -1) {
				browser = "Firefox"
				const match = userAgent.match(/Firefox\/([\d.]+)/)
				browserVersion = match ? match[1] : "Unknown"
			} else if (userAgent.indexOf("MSIE") > -1 || userAgent.indexOf("Trident") > -1) {
				browser = "Internet Explorer"
				const match = userAgent.match(/(?:MSIE |rv:)(\d+)/)
				browserVersion = match ? match[1] : "Unknown"
			} else {
				browser = "Unknown"
				browserVersion = "Unknown"
			}

			// Determine Device Type
			if (/Mobi|Android/i.test(userAgent)) {
				deviceType = "Mobile"
			} else {
				deviceType = "Desktop"
			}

			// Determine OS
			if (/iPhone|iPad|iPod/i.test(userAgent)) {
				os = "iOS"
			} else if (userAgent.indexOf("Mac OS X") > -1) {
				os = "Mac OS X"
			} else if (userAgent.indexOf("Windows NT") > -1) {
				os = "Windows"
			} else if (userAgent.indexOf("Android") > -1) {
				os = "Android"
			} else if (userAgent.indexOf("Linux") > -1) {
				os = "Linux"
			} else {
				os = "Unknown"
			}

			// Determine Browser Language Preference
			const browserLanguage =
				navigator.language || navigator.userLanguage || navigator.browserLanguage || "Unknown"

			return UserFlux.removeNullProperties({
				userAgent: userAgent,
				browser: browser,
				browserVersion: browserVersion,
				deviceType: deviceType,
				os: os,
				screenWidth: window.screen.width,
				screenHeight: window.screen.height,
				browserWidth: window.innerWidth,
				browserHeight: window.innerHeight,
				browserLanguage: browserLanguage,
			})
		} catch (error) {
			console.info("Error:", error)
			return null
		}
	}

	getCustomQueryParamProperties() {
		try {
			// Check if there are any custom query parameters to collect
			if (this.ufCustomQueryParamsToCollect.length == 0) return null

			// Check if running in a browser environment
			if (typeof window === "undefined") {
				return null
			}

			// Pickup any custom query parameters from the href, default to null if it doesn't exist
			let locationHref = window.location.href
			const urlSearchParams = new URLSearchParams(new URL(locationHref).search)

			let customQueryParams = {}
			this.ufCustomQueryParamsToCollect.forEach((param) => {
				customQueryParams[param] = urlSearchParams.get(param) || null
			})

			// Remove any null properties from the object before returning
			return UserFlux.removeNullProperties(customQueryParams)
		} catch (error) {
			console.info("Error for getCustomQueryParamProperties(): ", error)
			return null
		}
	}

	static getUTMProperties() {
		try {
			// Check if running in a browser environment
			if (typeof window === "undefined") {
				return null
			}

			let locationHref = window.location.href

			// Extract query parameters
			const urlSearchParams = new URLSearchParams(new URL(locationHref).search)
			let queryParams = {
				utmSource: urlSearchParams.get("utm_source") || null,
				utmMedium: urlSearchParams.get("utm_medium") || null,
				utmCampaign: urlSearchParams.get("utm_campaign") || null,
				utmTerm: urlSearchParams.get("utm_term") || null,
				utmContent: urlSearchParams.get("utm_content") || null,
				utmId: urlSearchParams.get("utm_id") || null,
				utmSourcePlatform: urlSearchParams.get("utm_source_platform") || null,
			}

			return UserFlux.removeNullProperties(queryParams)
		} catch (error) {
			console.info("Error for getUTMProperties(): ", error)
			return null
		}
	}

	static getPaidAdProperties() {
		try {
			// Check if running in a browser environment
			if (typeof window === "undefined") {
				return null
			}

			let locationHref = window.location.href

			// Extract query parameters
			const urlSearchParams = new URLSearchParams(new URL(locationHref).search)
			let queryParams = {
				gclid: urlSearchParams.get("gclid") || null,
				fbclid: urlSearchParams.get("fbclid") || null,
				msclkid: urlSearchParams.get("msclkid") || null,
			}

			return UserFlux.removeNullProperties(queryParams)
		} catch (error) {
			console.info("Error for getPaidAdProperties(): ", error)
			return null
		}
	}

	static getExternalIdQueryParam() {
		try {
			// Check if running in a browser environment
			if (typeof window === "undefined") {
				return null
			}

			let locationHref = window.location.href
			const urlSearchParams = new URLSearchParams(new URL(locationHref).search)
			return urlSearchParams.get("ufeid") || null
		} catch (error) {
			console.info("Error for getExternalIdQueryParam(): ", error)
			return null
		}
	}

	static getReferrerProperties() {
		try {
			// Check if running in a browser environment
			if (typeof window === "undefined") {
				return null
			}

			return UserFlux.removeNullProperties({
				referrerHref: document.referrer !== "" ? document.referrer : null,
				referrerHost: document.referrer ? new URL(document.referrer).hostname : null,
			})
		} catch (error) {
			console.info("Error getReferrerProperties(): ", error)
			return null
		}
	}

	// Utility function to set a cookie
	setCookie(name, value, days) {
		try {
			const cookieName = this.getStorageKey(name)
			let expires = ""

			if (days) {
				const date = new Date()
				date.setTime(date.getTime() + days * 24 * 60 * 60 * 1000)
				expires = "; expires=" + date.toUTCString()
			}

			// Set SameSite setting
			const sameSite = `; SameSite=${this.ufCookieSameSiteSetting}`

			// Dynamically determine the base domain
			const hostMatchRegex = /^(?:https?:\/\/)?(?:[^\/]+\.)?([^.\/]+\.(?:co\.uk|com\.au|com|co|money|io|is|dev|app|ai|vc|xyz|gg|net|me|health)).*$/i
			const matches = document.location.hostname.match(hostMatchRegex)
			const domain = matches ? matches[1] : ""
			const cookieDomain = domain ? "; domain=." + domain : ""

			document.cookie = cookieName + "=" + (value || "") + expires + sameSite + "; Secure" + cookieDomain + "; path=/"
		} catch (error) {
			console.info("Error:", error)
		}
	}

	// Utility function to get a cookie
	getCookie(name) {
		try {
			const nameEQ = this.getStorageKey(name) + "="
			const ca = document.cookie.split(";")
			for (let i = 0; i < ca.length; i++) {
				let c = ca[i]
				while (c.charAt(0) == " ") c = c.substring(1, c.length)
				if (c.indexOf(nameEQ) == 0) return c.substring(nameEQ.length, c.length)
			}
			return null
		} catch (error) {
			console.info("Error:", error)
			return null
		}
	}

	// Utility function to erase a cookie
	eraseCookie(name) {
		try {
			const cookieName = this.getStorageKey(name)
			// Dynamically determine the base domain
			const hostMatchRegex = /[a-z0-9][a-z0-9-]+\.[a-z]{2,}$/i
			const matches = document.location.hostname.match(hostMatchRegex)
			const domain = matches ? "; domain=." + matches[0] : ""

			document.cookie = cookieName + "=; Max-Age=-99999999; path=/" + "; domain=." + domain
		} catch (error) {
			console.info("Error:", error)
		}
	}

	// Method to check if localStorage is accessible
	isLocalStorageAccessible() {
		try {
			// Try to use localStorage
			const testKey = this.getStorageKey("uf-ls-test")
			localStorage.setItem(testKey, "test")
			localStorage.removeItem(testKey)
			return true
		} catch (e) {
			// Catch any errors, including security-related ones
			return false
		}
	}

	// Method to check if sessionStorage is accessible
	isSessionStorageAccessible() {
		try {
			const storage = window.sessionStorage
			const testKey = this.getStorageKey("uf-ss-test")
			storage.setItem(testKey, "test")
			storage.removeItem(testKey)
			return true
		} catch (e) {
			// Catch any errors, including security-related ones
			return false
		}
	}

	// Method to check if a strings value is null or empty
	// Handles edges cases where values retrieve from storage come back as string values instead of null
	static isStringNullOrBlank(value) {
		if (typeof value !== "string") return true
		return !value || value == null || value == undefined || value == "" || value == "null" || value == "undefined"
	}

	// Method to remove null properties from an object
	// Used for cleaning up the properties object of a event before tracking
	static removeNullProperties(object) {
		return Object.fromEntries(Object.entries(object).filter(([key, value]) => value !== null))
	}

	static isBotUserAgent(userAgent) {
		// Convert to lowercase for case-insensitive matching
		const lowerUA = userAgent.toLowerCase()

		// Check for empty or missing user agent, if so, assume it's not a bot
		if (!userAgent || userAgent.trim() === "") {
			return false
		}

		// List of common bot keywords
		const botKeywords = [
			"bot",
			"crawler",
			"spider",
			"scraper",
			"indexer",
			"archiver",
			"slurp",
			"googlebot",
			"bingbot",
			"yandexbot",
			"duckduckbot",
			"baiduspider",
			"twitterbot",
			"facebookexternalhit",
			"linkedinbot",
			"msnbot",
			"slackbot",
			"telegrambot",
			"applebot",
			"pingdom",
			"ia_archiver",
			"semrushbot",
			"ahrefsbot",
			"monotybot",
			"amazon-qbusiness",
			"google-safety",
			"amazon-kendra",
		]

		// Check for bot keywords
		for (const keyword of botKeywords) {
			if (lowerUA.includes(keyword)) {
				return true
			}
		}

		// Check for common bot patterns
		if (
			/(?:^|\W)spider(?:$|\W)/i.test(userAgent) ||
			/(?:^|\W)crawl(?:er|ing)(?:$|\W)/i.test(userAgent) ||
			/(?:^|\W)bot(?:$|\W)/i.test(userAgent) ||
			/\+https?:\/\//i.test(userAgent)
		) {
			return true
		}

		// If none of the above conditions are met, it's likely not a bot
		return false
	}
}

module.exports = UserFlux
