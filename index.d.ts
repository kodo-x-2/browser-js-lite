// index.d.ts
declare module "@userflux/browser-js-lite" {
	declare class UserFlux {
		constructor(apiKey?: string, options?: object)

		initialize(apiKey: string, options?: object): void
		identify(parameters: object): Promise<any>
		track(parameters: object): Promise<any | null>
		trackBatch(parameters: object[]): Promise<void>
		reset(): Promise<void>
		updateDefaultTrackingProperties(properties: object): void
		getUserId(): string | null
		getAnonymousId(): string | null
		getSessionId(): string | null
		flush(): Promise<void>
		trackPageView(): Promise<void>

		static createInstance(apiKey?: string, options?: object): UserFlux
		static initialize(apiKey: string, options?: object): void
		static identify(parameters: object): Promise<any>
		static track(parameters: object): Promise<any | null>
		static trackBatch(parameters: object[]): Promise<void>
		static reset(): Promise<void>
		static updateDefaultTrackingProperties(properties: object): void
		static getUserId(): string | null
		static getAnonymousId(): string | null
		static getSessionId(): string | null
		static flush(): Promise<void>
		static trackPageView(): Promise<void>
	}

	export = UserFlux
}
