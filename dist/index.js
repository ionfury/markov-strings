"use strict";
const lodash_1 = require("lodash");
const debug = require("debug");
const warn = debug("markov-strings:warning");
class Markov {
    /**
     * Creates an instance of Markov generator.
     * @param {(string[] | Array<{ string: string }>)} data An array of strings or objects.
     * If 'data' is an array of objects, each object must have a 'string' attribute
     * @param {any} [options={}] An object of options. If not set, sensible defaults will be used.
     * @memberof Markov
     */
    constructor(data, options = {}) {
        this.startWords = [];
        this.endWords = [];
        this.corpus = {};
        this.defaultOptions = {
            stateSize: 2,
            maxLength: 0,
            minWords: 0,
            maxWords: 0,
            minScore: 0,
            minScorePerWord: 0,
            maxTries: 10000,
            checker: undefined,
            filter: undefined
        };
        this._checkOptions(options, "constructor");
        // Format data if necessary
        if (lodash_1.isString(data[0])) {
            data = data.map(s => ({ string: s }));
        }
        else if (!data[0].hasOwnProperty("string")) {
            throw new Error('Objects in your corpus must have a "string" property');
        }
        this.data = data;
        // Save options
        this.options = this.defaultOptions;
        lodash_1.assignIn(this.options, options);
    }
    /**
     * Builds the corpus
     *
     * @returns {Promise<void>}
     * @memberof Markov
     */
    buildCorpus() {
        return new Promise((resolve, reject) => {
            resolve(this.buildCorpusSync());
        });
    }
    /**
     * Builds the corpus (synced method)
     *
     * @memberof Markov
     */
    buildCorpusSync() {
        const options = this.options;
        this.corpus = {};
        this.data.forEach(item => {
            const line = item.string;
            const words = line.split(" ");
            const stateSize = options.stateSize;
            // Start words
            const start = lodash_1.slice(words, 0, stateSize).join(" ");
            const oldStartObj = this.startWords.find(o => o.words === start);
            if (oldStartObj) {
                if (!lodash_1.includes(oldStartObj.refs, item)) {
                    oldStartObj.refs.push(item);
                }
            }
            else {
                this.startWords.push({ words: start, refs: [item] });
            }
            // End words
            const end = lodash_1.slice(words, words.length - stateSize, words.length).join(" ");
            const oldEndObj = this.endWords.find(o => o.words === end);
            if (oldEndObj) {
                if (!lodash_1.includes(oldEndObj.refs, item)) {
                    oldEndObj.refs.push(item);
                }
            }
            else {
                this.endWords.push({ words: end, refs: [item] });
            }
            // Build corpus
            for (let i = 0; i < words.length - 1; i++) {
                const curr = lodash_1.slice(words, i, i + stateSize).join(" ");
                const next = lodash_1.slice(words, i + stateSize, i + stateSize * 2).join(" ");
                if (!next || next.split(" ").length !== options.stateSize) {
                    continue;
                }
                // add block to corpus
                if (this.corpus.hasOwnProperty(curr)) {
                    // if corpus already owns this chain
                    const oldObj = this.corpus[curr].find(o => o.words === next);
                    if (oldObj) {
                        oldObj.refs.push(item);
                    }
                    else {
                        this.corpus[curr].push({ words: next, refs: [item] });
                    }
                }
                else {
                    this.corpus[curr] = [{ words: next, refs: [item] }];
                }
            }
        });
    }
    /**
     * Generates a result, that contains a string and its references
     *
     * @param {MarkovOptions} options
     * @returns {Promise<MarkovResult>}
     * @memberof Markov
     */
    generateSentence(options) {
        this._checkOptions(options, "generateSentence");
        return new Promise((resolve, reject) => {
            try {
                const result = this.generateSentenceSync(options);
                resolve(result);
            }
            catch (e) {
                reject(e);
            }
        });
    }
    /**
     * Generates a result, that contains a string and its references (synced method)
     *
     * @param {MarkovOptions} [options={}]
     * @returns {MarkovResult}
     * @memberof Markov
     */
    generateSentenceSync(options = {}) {
        if (!this.corpus) {
            throw new Error("Corpus is not built.");
        }
        this._checkOptions(options, "generateSentenceSync");
        const newOptions = {};
        lodash_1.assignIn(newOptions, this.options, options);
        options = newOptions;
        const corpus = lodash_1.cloneDeep(this.corpus);
        const max = options.maxTries;
        // loop for maximum tries
        for (let i = 0; i < max; i++) {
            let ended = false;
            const arr = [lodash_1.sample(this.startWords)];
            let score = 0;
            // loop to build sentence
            let limit = 0;
            while (limit < max) {
                const block = arr[arr.length - 1]; // last value in array
                const state = lodash_1.sample(corpus[block.words]);
                // sentence cannot be finished
                if (!state) {
                    break;
                }
                // add new state to list
                arr.push(state);
                // increment score
                score += corpus[block.words].length - 1; // increment score
                // is sentence finished?
                if (lodash_1.some(this.endWords, { words: state.words })) {
                    ended = true;
                    break;
                }
                limit++;
            }
            const scorePerWord = Math.ceil(score / arr.length);
            const sentence = arr.map(o => o.words).join(" ").trim();
            const result = {
                string: sentence,
                score,
                scorePerWord,
                refs: lodash_1.uniqBy(lodash_1.flatten(arr.map(o => o.refs)), "string")
            };
            // sentence is not ended or incorrect
            if (!ended ||
                typeof options.checker === "function" && !options.checker(sentence) || // checker cb returns false
                typeof options.filter === "function" && !options.filter(result) ||
                options.minWords && options.minWords > 0 && sentence.split(" ").length < options.minWords ||
                options.maxWords && options.maxWords > 0 && sentence.split(" ").length > options.maxWords ||
                options.maxLength && options.maxLength > 0 && sentence.length > options.maxLength ||
                options.minScore && score < options.minScore ||
                options.minScorePerWord && scorePerWord < options.minScorePerWord) {
                continue;
            }
            return result;
        }
        throw new Error("Cannot build sentence with current corpus and options");
    }
    _checkOptions(options, methodName) {
        if (options && typeof options.checker !== "undefined") {
            warn(`You've passed an 'options' object with 'checker' ` +
                `property set to 'MarkovGenerator.${methodName}'. ` +
                `'checker(sentence)' property is deprecated and will be removed ` +
                `in future versions of the library. ` +
                `Please use 'filter(result)' property instead.`);
        }
    }
}
module.exports = Markov;
