declare module 'better-sqlite3' {
	export interface RunResult {
		changes: number;
		lastInsertRowid: number | bigint;
	}

		export interface Statement<T = unknown> {
			run(...params: unknown[]): RunResult;
			get(...params: unknown[]): T | undefined;
			all(...params: unknown[]): any;
			iterate(...params: unknown[]): IterableIterator<any>;
			raw(runRaw?: boolean): Statement<T>;
			bind(...params: unknown[]): Statement<T>;
	}

	export type TransactionFunction<TArgs extends unknown[], TResult> = (...params: TArgs) => TResult;

	export interface Transaction {
		<TArgs extends unknown[], TResult>(fn: TransactionFunction<TArgs, TResult>): TransactionFunction<TArgs, TResult>;
	}

	export interface DatabaseOptions {
		memory?: boolean;
		readonly?: boolean;
		fileMustExist?: boolean;
		timeout?: number;
		verbose?: (...args: unknown[]) => void;
	}

	export default class Database {
		constructor(filename: string, options?: DatabaseOptions);
		prepare<T = unknown>(source: string): Statement<T>;
		transaction: Transaction;
		exec(source: string): this;
		pragma(source: string, options?: { simple?: boolean }): unknown;
		close(): void;
		defaultSafeIntegers(toggle?: boolean): this;
	}
}