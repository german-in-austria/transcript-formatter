"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const pgp = require("pg-promise");
const _ = require("lodash");
const format = require("pg-format");
const db = pgp()('postgres://postgres:password@localhost:5432/postgres');
exports.default = {
    writeTokens(tokens) {
        return __awaiter(this, void 0, void 0, function* () {
            var values = _(tokens).map(t => _(t).toArray().value()).value();
            const dbresult = yield db.query(format(`INSERT INTO
      transcript.tokens(
        token_id,
        speaker,
        text,
        ortho,
        fragment_of,
        event_id,
        start_timepoint,
        end_timepoint,
        transcript_name)
      VALUES %L`, values));
            console.log(dbresult);
            return dbresult;
        });
    }
};
