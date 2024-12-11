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
var version = '1.2';

console.info(`[phab-info]: loading (v${version})...`);
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
 * Get the assigned tasks.
 * @returns {Promise<HTMLElement|boolean>}
 */
async function getAssignedTasks() {
    // Yeah these will NEVER change.. /s
    if (document.getElementById('UQ4_0')) {
        console.debug('[phab-info]: using dashboard layout');
        return document.getElementById('UQ4_0');
    } else if (document.getElementById('UQ0_190')) {
        console.debug('[phab-info]: using assigned task query layout');
        return document.getElementById('UQ0_190');
    } else {
        return false;
    }
}

/**
 * Process the page.
 */
async function start() {
    perf.start = new Date().getTime();
    const assignedTasks = await getAssignedTasks();
    if (!assignedTasks) {
        console.error('[phab-info]: no tasks found');
        return;
    }
    const phabTasks = assignedTasks.getElementsByClassName('phui-oi-name');
    console.debug('[phab-info]: processing tasks...');
    await checkCacheExpiry();
    for (var i = 0; i < phabTasks.length; i++) {
        const task = phabTasks[i];
        const taskId = task.getElementsByTagName('span')[0].innerText;
        const taskTitle = task.getElementsByTagName('a')[0].innerText;
        console.debug(`[phab-info]: processing task ${taskId}: ${taskTitle}`);
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
    console.debug('[phab-info]: done');
    console.debug(`[phab-info]: took ${seconds} seconds`);
    console.debug(`[phab-info]: ${totals.tags} tag columns identified`);
    console.debug(`[phab-info]: ${totals.cacheHits} cache hits`);
    console.debug(`[phab-info]: ${totals.cacheMisses} cache misses`);
    console.debug(`[phab-info]: ${totals.requests} web requests made`);
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
    for (var i = 0; i < taskTags.length; i++) {
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
    // Update the cache timestamp
    window.localStorage.setItem(
        'phab-info_cache_timestamp',
        new Date().getTime()
    );
}

/**
 * Check if the cache has expired, and clear it if it has.
 */
async function checkCacheExpiry() {
    let cache_timestamp = window.localStorage.getItem(
        'phab-info_cache_timestamp'
    );
    if (cache_timestamp) {
        let now = new Date().getTime();
        // Clear the cache if it's older than an hour
        if (now - cache_timestamp > 3600000) {
            console.debug('[phab-info]: cache expired, clearing...');
            window.localStorage.removeItem('phab-info_cache');
            window.localStorage.removeItem('phab-info_cache_timestamp');
        } else {
            console.debug('[phab-info]: cache is still fresh');
        }
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
