/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as json from 'jsonc-parser';
import { languages } from './fillers/monaco-editor-core';

export function createTokenizationSupport(
	supportComments: boolean
): languages.TokensProvider {
	return {
		getInitialState: () => new JSONState(null, null, false, []),
		tokenize: (line, state, offsetDelta?, stopAtOffset?) =>
			tokenize(
				supportComments,
				line,
				<JSONState>state,
				offsetDelta,
				stopAtOffset
			)
	};
}

export const TOKEN_DELIM_OBJECT = 'delimiter.bracket.json';
export const TOKEN_DELIM_ARRAY = 'delimiter.array.json';
export const TOKEN_DELIM_COLON = 'delimiter.colon.json';
export const TOKEN_DELIM_COMMA = 'delimiter.comma.json';
export const TOKEN_VALUE_BOOLEAN = 'keyword.json';
export const TOKEN_VALUE_NULL = 'keyword.json';
export const TOKEN_VALUE_STRING = 'string.value.json';
export const TOKEN_VALUE_NUMBER = 'number.json';
export const TOKEN_PROPERTY_NAME = 'string.key.json';
export const TOKEN_COMMENT_BLOCK = 'comment.block.json';
export const TOKEN_COMMENT_LINE = 'comment.line.json';

enum JSONParent {
	Object = 0,
	Array = 1
}

class JSONState implements languages.IState {
	private _state: languages.IState;

	public scanError: json.ScanError;
	public lastWasColon: boolean;
	public parents: JSONParent[];

	constructor(
		state: languages.IState,
		scanError: json.ScanError,
		lastWasColon: boolean,
		parents: JSONParent[]
	) {
		this._state = state;
		this.scanError = scanError;
		this.lastWasColon = lastWasColon;
		this.parents = parents;
	}

	private static areArraysEqual(first: JSONParent[], second: JSONParent[]) {
		if (first === second) {
			return true;
		}

		if (first == null || second === null) {
			return false;
		}

		if (first.length !== second.length) {
			return false;
		}

		let index = -1;
		while (++index < first.length) {
			if (first[index] !== second[index]) {
				return false;
			}
		}

		return true;
	}

	public clone(): JSONState {
		return new JSONState(
			this._state,
			this.scanError,
			this.lastWasColon,
			this.parents
		);
	}

	public equals(other: languages.IState): boolean {
		if (other === this) {
			return true;
		}
		if (!other || !(other instanceof JSONState)) {
			return false;
		}
		return (
			this.scanError === (<JSONState>other).scanError &&
			this.lastWasColon === (<JSONState>other).lastWasColon &&
			JSONState.areArraysEqual(this.parents, (<JSONState>other).parents)
		);
	}

	public getStateData(): languages.IState {
		return this._state;
	}

	public setStateData(state: languages.IState): void {
		this._state = state;
	}
}

function tokenize(
	comments: boolean,
	line: string,
	state: JSONState,
	offsetDelta: number = 0,
	stopAtOffset?: number
): languages.ILineTokens {
	// handle multiline strings and block comments
	let numberOfInsertedCharacters = 0;
	let adjustOffset = false;

	switch (state.scanError) {
		case json.ScanError.UnexpectedEndOfString:
			line = '"' + line;
			numberOfInsertedCharacters = 1;
			break;
		case json.ScanError.UnexpectedEndOfComment:
			line = '/*' + line;
			numberOfInsertedCharacters = 2;
			break;
	}

	let scanner = json.createScanner(line),
		lastWasColon = state.lastWasColon,
		parents = Array.from(state.parents);

	const ret: languages.ILineTokens = {
		tokens: <languages.IToken[]>[],
		endState: state.clone()
	};

	while (true) {
		let offset = offsetDelta + scanner.getPosition();
		let type = '';

		const kind = scanner.scan();
		if (kind === json.SyntaxKind.EOF) {
			break;
		}

		// Check that the scanner has advanced
		if (offset === offsetDelta + scanner.getPosition()) {
			throw new Error(
				'Scanner did not advance, next 3 characters are: ' +
					line.substr(scanner.getPosition(), 3)
			);
		}

		// In case we inserted /* or " character, we need to
		// adjust the offset of all tokens (except the first)
		if (adjustOffset) {
			offset -= numberOfInsertedCharacters;
		}
		adjustOffset = numberOfInsertedCharacters > 0;

		// brackets and type
		switch (kind) {
			case json.SyntaxKind.OpenBraceToken:
				parents.push(JSONParent.Object);
				type = TOKEN_DELIM_OBJECT;
				lastWasColon = false;
				break;
			case json.SyntaxKind.CloseBraceToken:
				parents.pop();
				type = TOKEN_DELIM_OBJECT;
				lastWasColon = false;
				break;
			case json.SyntaxKind.OpenBracketToken:
				parents.push(JSONParent.Array);
				type = TOKEN_DELIM_ARRAY;
				lastWasColon = false;
				break;
			case json.SyntaxKind.CloseBracketToken:
				parents.pop();
				type = TOKEN_DELIM_ARRAY;
				lastWasColon = false;
				break;
			case json.SyntaxKind.ColonToken:
				type = TOKEN_DELIM_COLON;
				lastWasColon = true;
				break;
			case json.SyntaxKind.CommaToken:
				type = TOKEN_DELIM_COMMA;
				lastWasColon = false;
				break;
			case json.SyntaxKind.TrueKeyword:
			case json.SyntaxKind.FalseKeyword:
				type = TOKEN_VALUE_BOOLEAN;
				lastWasColon = false;
				break;
			case json.SyntaxKind.NullKeyword:
				type = TOKEN_VALUE_NULL;
				lastWasColon = false;
				break;
			case json.SyntaxKind.StringLiteral:
				let currentParent = parents.length
					? parents[parents.length - 1]
					: JSONParent.Object;
				let inArray = currentParent === JSONParent.Array;
				type =
					lastWasColon || inArray ? TOKEN_VALUE_STRING : TOKEN_PROPERTY_NAME;
				lastWasColon = false;
				break;
			case json.SyntaxKind.NumericLiteral:
				type = TOKEN_VALUE_NUMBER;
				lastWasColon = false;
				break;
		}

		// comments, iff enabled
		if (comments) {
			switch (kind) {
				case json.SyntaxKind.LineCommentTrivia:
					type = TOKEN_COMMENT_LINE;
					break;
				case json.SyntaxKind.BlockCommentTrivia:
					type = TOKEN_COMMENT_BLOCK;
					break;
			}
		}

		ret.endState = new JSONState(
			state.getStateData(),
			scanner.getTokenError(),
			lastWasColon,
			parents
		);
		ret.tokens.push({
			startIndex: offset,
			scopes: type
		});
	}

	return ret;
}
