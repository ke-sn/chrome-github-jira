// The last time a refresh of the page was done
let lastRefresh = (new Date()).getTime();
let jiraLogo = chrome.runtime.getURL("images/jira.png");
const jiraUrl = "gocro-dev.atlassian.net";
const REFRESH_TIMEOUT = 250;

main().catch(err => console.error('Unexpected error', err))

const PAGE_PR = 'PAGE_PR';

const GITHUB_PAGE_PULL = /github\.com\/(.*)\/(.*)\/pull\//

function commitStreamEl(href, content) {
    const el = document.createElement('div');
    el.innerHTML = `
        <a href="${href}">${content[0]}</a>
        <a href="${getJiraUrl(content[1])}" target="_blank" alt="Ticket in Jira"><b>${content[1]}</b></a>
        <a href="${href}">${content[2].trim()}</a>
    `;
    return el;
}

function titleHTMLContent(title, issueKey) {
    return title.replace(/([A-Z0-9]+-[0-9]+)/, `
        <a href="${getJiraUrl(issueKey)}" target="_blank" alt="Ticket in Jira">${issueKey}</a>
    `);
}


function userHTMLContent(text, user) {
    if (user && typeof user === 'object') {
        const { avatarUrls, displayName } = user
        return `
            <div class="d-inline-block">
                ${text}
                <span class="author text-bold">
                    <a class="no-underline"><img style="float:none;margin-right:0" class="avatar avatar-user" src="${avatarUrls['16x16']}" width="20"/></a>
                    ${displayName}
                </span>
            </div>
        `
    }
    return ''
}

function buildLoadingElement(issueKey) {
    const el = document.createElement('div');
    el.id = 'insertedJiraData';
    el.className = 'gh-header-meta';
    el.innerText = `Loading ticket ${issueKey}...`;
    return el;
}

function statusIconBlock(statusIcon) {
    if (!statusIcon) {
        return ''
    }

    const origin = new URL(statusIcon).origin
    const base = new URL(origin).href

    // If the icon is the same as its origin, it most probably is not an image
    if (statusIcon === origin || statusIcon === base) {
        return ''
    }

    return `<img height="16" class="octicon" width="12" aria-hidden="true" src="${statusIcon}"/>`
}

function statusCategoryColors(statusCategory) {
    // There are only "blue", "green", and "grey" in Jira
    switch (statusCategory.colorName) {
        case "blue":
        case "yellow":
            return { color: "#0747A6", background: "#B3D4FF" }
        case "green":
            return { color: "#006644", background: "#ABF5D1" }
        default:
            return { color: "rgb(40, 40, 40)", background: "rgb(220, 220, 220)" }
    }
}

function headerBlock(issueKey,
    {
        assignee,
        reporter,
        status: { iconUrl: statusIcon, name: statusName, statusCategory } = {},
        summary
    } = {}
) {
    const issueUrl = getJiraUrl(issueKey)
    const statusIconHTML = statusIconBlock(statusIcon)
    const { color: statusColor, background: statusBackground } = statusCategoryColors(statusCategory);
    return `
        <div class="TableObject gh-header-meta">
            <div class="TableObject-item">
                <span class="State State--green" style="background-color: rgb(150, 198, 222);">
                    <img height="16" class="octicon" width="12" aria-hidden="true" src="${jiraLogo}"/>
                    <a style="color:white;" href="${issueUrl}" target="_blank">Jira</a>
                </span>
            </div>
            <div class="TableObject-item">
                <span class="State State--white" style="color: ${statusColor}; background: ${statusBackground}">
                    ${statusName}
                </span>
            </div>
            <div class="TableObject-item TableObject-item--primary">
                <strong>
                    <a href="${issueUrl}" target="_blank">
                        ${issueKey} - ${summary}
                    </a>
                </strong>
                <div class="d-inline-block">
                    ${userHTMLContent('Reported by', reporter)}
                    ${userHTMLContent('and assigned to', assignee)}
                </div>
            </div>
        </div>
    `
}

/////////////////////////////////
// FUNCTIONS
/////////////////////////////////

async function main(items) {

    //Check login
    try {
        const { name } = await sendMessage({ query: 'getSession', jiraUrl });

        // Check page if content changed (for AJAX pages)
        document.addEventListener('DOMNodeInserted', () => {
            if ((new Date()).getTime() - lastRefresh >= REFRESH_TIMEOUT) {
                lastRefresh = (new Date()).getTime();
                checkPage();
            }
        });

        // Check page initially
        checkPage();
    } catch(e) {
        console.error(`You are not logged in to Jira at http://${jiraUrl} - Please login.`);
    }
}


function getJiraUrl(route = '') {
    return `https://${jiraUrl}/browse/${route}`
}

async function sendMessage(data) {
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(data, resolve);
    })
}


function onPageChange(page) {
    setTimeout(function() {
        handleCommitsTitle();
        if (page === PAGE_PR) handlePrPage();
    }, 200); //Small timeout for dom to finish setup
}

function checkPage() {
    let url = window.location.href;
    if (url.match(GITHUB_PAGE_PULL) != null) {
        onPageChange(PAGE_PR)
    }
}


function handleCommitsTitle() {
    document.querySelectorAll('.commit-message code').forEach((el) => {
        const linkEl = el.querySelector('a');
        const linkHtml = linkEl.innerHTML;
        const splittedContent = linkHtml.split(/([A-Z]+-[0-9]+)/g);

        if (splittedContent.length < 3) {
            return;
        }

        const contentEl = document.createElement('div');
        for(var i=0; i< splittedContent.length; i+=3) {
            contentEl.appendChild(commitStreamEl(linkEl.getAttribute('href'), splittedContent));
        }
        el.innerHTML = '';
        el.appendChild(contentEl);
    });
}

async function handlePrPage() {
    const titleEl = document.querySelector('h1 > bdi.js-issue-title');
    const branchElement = document.querySelector('span.commit-ref.head-ref > a > span');
    const insertedJiraDataEl = document.querySelector('#insertedJiraData');
    const partialDiscussionHeaderEl = document.querySelector('#partial-discussion-header');
    if (!titleEl && !branchElement || insertedJiraDataEl) {
        //If we didn't find a ticket, or the data is already inserted, cancel.
        return false;
    }

    const title = titleEl.innerHTML;
    const branchName = branchElement.innerHTML;

    let ticketNumber = null;
    let matchResult = title.match(/([A-Z0-9]+-[0-9]+)/);
    if (matchResult) {
        ticketNumber = matchResult[0];
    } else {
        matchResult = branchName.match(/([A-Z0-9]+-[0-9]+)/);
        if (matchResult) {
            ticketNumber = matchResult[0];
        }
    }
    if (!ticketNumber) {
        return false;
    }

    //Replace title with clickable link to jira ticket
    titleEl.innerHTML = titleHTMLContent(title, ticketNumber);

    //Open up a handle for data
    const loadingElement = buildLoadingElement(ticketNumber);
    partialDiscussionHeaderEl.appendChild(loadingElement);

    //Load up data from jira
    try {
        const result = await sendMessage({ query: 'getTicketInfo', jiraUrl, ticketNumber })
        if (result.errors) {
            throw new Error(result.errorMessages);
        }
        loadingElement.innerHTML = headerBlock(ticketNumber, result.fields);
    } catch(e) {
        console.error('Error fetching data', e)
        loadingElement.innerText = e.message;
    }
}
