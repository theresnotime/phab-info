// Ew, globals
var timeout;
var totals = {
    requests: 0,
    tags: 0,
    cacheHits: 0,
    cacheMisses: 0,
};
var perf = {
    start: null,
    end: null,
};

console.info('[phab-info]: loading...');
window.onload = (event) => {
    checkLoaded();
};

/**
 * Check if the page has fully loaded, retrying every second until it has.
 */
function checkLoaded() {
    if (document.getElementsByClassName('phui-oi-objname').length > 1) {
        clearTimeout(timeout);
        start();
    } else {
        timeout = setTimeout(checkLoaded, 1000);
    }
}

/**
 * Process the page.
 */
async function start() {
    perf.start = new Date().getTime();
    const phabTasks = document.getElementsByClassName('phui-oi-name');
    console.info('[phab-info]: processing tasks...');
    for (var i = 0; i < phabTasks.length; i++) {
        const task = phabTasks[i];
        const taskId = task.getElementsByTagName('span')[0].innerText;
        const taskTags = task.nextSibling.getElementsByClassName(
            'phabricator-handle-tag-list-item'
        );
        const taskScrape = await scrapePhab(taskId);

        for (var j = 0; j < taskTags.length; j++) {
            const tag = taskTags[j];
            const tagLink = tag.getElementsByTagName('a')[0];
            if (tagLink) {
                await setTitle(tagLink, taskId, taskScrape);
            }
        }
    }
    end();
}

/**
 * End the process and print some stats.
 */
function end() {
    perf.end = new Date().getTime();
    const seconds = Math.floor(((perf.end - perf.start) / 1000) % 60);
    console.info('[phab-info]: done');
    console.info(`[phab-info]: took ${seconds} seconds`);
    console.info(`[phab-info]: ${totals.tags} tag columns identified`);
    console.info(`[phab-info]: ${totals.cacheHits} cache hits`);
    console.info(`[phab-info]: ${totals.cacheMisses} cache misses`);
    console.info(`[phab-info]: ${totals.requests} web requests made`);
}

/**
 * Scrape a phabricator task page.
 *
 * @param {string} taskId
 * @returns {Promise<Document>}
 */
async function scrapePhab(taskId) {
    // Check if we have a cached scrape
    let cachedScrape = await getCachedScrape(taskId);
    if (cachedScrape) {
        totals.cacheHits++;
        return cachedScrape;
    }
    totals.cacheMisses++;

    // If we don't have a cached scrape, fetch it
    let headers = new Headers({
        'User-Agent': 'User:TheresNoTime, phab-info',
    });
    // Oh yeah, we're doing this because phab's API is awful
    // like.. it's literally easier to scrape the web page
    // than attempting to use the API
    let url = 'https://phabricator.wikimedia.org/' + taskId;
    const response = await fetch(url, { headers: headers });
    const responseText = await response.text();
    totals.requests++;
    let doc = new DOMParser().parseFromString(responseText, 'text/html');
    const taskTags = doc.getElementsByClassName(
        'phabricator-handle-tag-list-item'
    );
    let cols = {};
    for (var i = 0, l = taskTags.length; i < l; i++) {
        const tag = taskTags[i];
        const tagLinks = tag.getElementsByTagName('a');
        const tagText = tagLinks[0].innerText;
        if (tagLinks.length > 1) {
            const tagCol = tag.getElementsByTagName('a')[1].innerText;
            cols[tagText] = tagCol;
        }
    }
    await cacheScrape(taskId, cols);
    return cols;
}

/**
 * Cache the phab task scrape.
 *
 * @param {string} taskId
 * @param {object} responseText
 */
async function cacheScrape(taskId, responseText) {
    let cache = window.localStorage.getItem('phab-info_cache');
    if (cache) {
        cache = JSON.parse(cache);
        cache[taskId] = responseText;
        window.localStorage.setItem('phab-info_cache', JSON.stringify(cache));
    } else {
        cacheContent = JSON.stringify({
            [taskId]: responseText,
        });
        window.localStorage.setItem('phab-info_cache', cacheContent);
    }
}

/**
 * Retrieve a cached scrape.
 *
 * @param {string} taskId
 * @returns {Promise<string|boolean>}
 */
async function getCachedScrape(taskId) {
    let cache = window.localStorage.getItem('phab-info_cache');
    if (cache) {
        cache = JSON.parse(cache);
        if (cache[taskId]) {
            return cache[taskId];
        } else {
            return false;
        }
    } else {
        return false;
    }
}

/**
 * Parse the scrape for a task.
 *
 * @param {HTMLCollection} taskTags
 * @param {string} forTag
 * @returns {Promise<string|boolean>}
 */
async function parseScrape(taskTags, forTag) {
    return taskTags[forTag] || false;
}

/**
 * Set the title of a tag link to the column it's in.
 *
 * @param {string} tagLink
 * @param {string} taskId
 * @param {HTMLCollection} taskScrape
 */
async function setTitle(tagLink, taskId, taskScrape) {
    const tagText = tagLink.innerText;
    let tagCol = await parseScrape(taskScrape, tagText);
    if (tagCol !== false) {
        totals.tags++;
        tagLink.setAttribute('title', tagCol);
    }
}
