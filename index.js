const http = require("http");
const https = require("https");
const fs = require("fs");
const crypto = require("crypto");
const querystring = require("querystring");

const resHeader = {
    "Content-Type": "text/html; charset=utf-8",
    "Transfer-Encoding": "chunked" 
};

const session = new Map();

const port = 3000;
const host = "localhost";
const server = http.createServer();

server.listen(port, host, () => {
    process.stdout.write("\n\n> Server Created\t");
    console.log(server.address());
});

server.on("request", (req, res) => {
    // client enters http://localhost:3000
    if (req.url === "/"){
        console.log(`\n> REQ<: Landing Page\t${req.socket.remoteAddress}\t${req.url}`);

        // res.writeHead(200, resHeader);
        // const landingPage = fs.createReadStream("html/landing.html");
        // landingPage.pipe(res);

        writePage(res, "landing.html");
    }

    // browser requests stylesheet
    else if (req.url.startsWith("/style")){
        console.log(`\n> REQ<: Stylesheet\t${req.socket.remoteAddress}\t${req.url}`);

        const queryIndex = req.url.lastIndexOf('/');
        const file = queryIndex !== -1 ? req.url.slice(queryIndex + 1) : '';

        const resHeaderCSS = {
            "Content-Type": "text/css; charset=utf-8",
            "Transfer-Encoding": "chunked" 
        };
        res.writeHead(200, resHeaderCSS);
        const landingPage = fs.createReadStream(`html/${file}`);
        landingPage.pipe(res);
    }

    // client submits desired manga name
    else if (req.url.startsWith("/mangaSelect")){
        console.log(`\n> REQ<: Req Recieved\t${req.socket.remoteAddress}\t${req.url}`);

        const queryIndex = req.url.indexOf('?');
        const queryString = queryIndex !== -1 ? req.url.slice(queryIndex + 1) : '';
        const clientInput = new URLSearchParams(queryString);

        const searchName = clientInput.get("name");
        const paginationNum = Number(clientInput.get("paginationNum"));

        if (searchName === ""){
            quickResponse(res, 400, "400 Invalid Inputs");
            return;
        }

        mangaLookup(res, searchName, paginationNum);
    }

    // client selects manga result 
    else if (req.url.startsWith("/chapterSelect")){
        console.log(`\n> REQ<: Req Recieved\t${req.socket.remoteAddress}\t${req.url}`);

        const queryIndex = req.url.indexOf('?');
        const queryString = queryIndex !== -1 ? req.url.slice(queryIndex + 1) : '';
        const clientInput = new URLSearchParams(queryString);

        const mangaId = clientInput.get("mangaId");
        const mangaName = clientInput.get("mangaName");
        const paginationNum = Number(clientInput.get("paginationNum"));
        // quickResponse(res, 200, `${mangaId} ${mangaName}`)

        getChapter(res, mangaId, mangaName, paginationNum);
    }

    // client selects manga's chapter
    else if (req.url.startsWith("/finishSelection")){
        console.log(`\n> REQ<: Req Recieved\t${req.socket.remoteAddress}\t${req.url}`);

        const queryIndex = req.url.indexOf('?');
        const queryString = queryIndex !== -1 ? req.url.slice(queryIndex + 1) : '';
        const clientInput = new URLSearchParams(queryString);

        const mangaName = clientInput.get("mangaName");
        const chapterId = clientInput.get("chapterId");
        const chapterNum = clientInput.get("chapterNum") - 1;
        console.log({mangaName, chapterId, chapterNum});

        getPages(res, chapterId, chapterNum, mangaName);
    }

    // client completes oAuth & grants access
    else if (req.url.startsWith("/callback")){
        const queryIndex = req.url.indexOf('?');
        const queryString = queryIndex !== -1 ? req.url.slice(queryIndex + 1) : '';
        const callbackParams = new URLSearchParams(queryString);

        const state = callbackParams.get("state");
        const iss = callbackParams.get("iss");
        const code = callbackParams.get("code");
        const scope = callbackParams.get("scope");

        process.stdout.write(`\n> REQ<: Return from OAuth\t${req.socket.remoteAddress}\t/callback...\t`);
        console.log({state, iss, code, scope});
        
        tokenExchange(res, code, state);
    }

    // client tries to request anything else
    // else quickResponse(res, 404, `404 Request Doesn't Exist`);
    else writePage(res, "request404.html");
});

function quickResponse(res, statusCode, msg){
    res.writeHead(statusCode, resHeader);
    res.end(`<h1>${msg}</h1>`);
}

function writePage(res, pageContent){
    res.writeHead(200, resHeader);
    const pageHead = fs.createReadStream("html/header.html");
    pageHead.pipe(res, {end: false});
    pageHead.on("end", () => {
        const pageMain = fs.createReadStream(`html/${pageContent}`);
        pageMain.pipe(res, {end: false});
        pageMain.on("end", () => {
            const pageFoot = fs.createReadStream("html/footer.html");
            pageFoot.pipe(res);
        });
    });
}

function writePageManually(res, callback, cbParams){
    res.writeHead(200, resHeader);
    const pageHead = fs.createReadStream("html/header.html");
    pageHead.pipe(res, {end: false});

    pageHead.on("end", () => {
        callback(res, cbParams);
        const pageFoot = fs.createReadStream("html/footer.html");
        pageFoot.pipe(res);
    });
}

// MangaDex Lookup API calls ============================== 

const optionsMangaDex = {
    method: "GET",
    headers: {"User-Agent": process.env.USER_AGENT},
};

function mangaLookup(res, searchName, paginationNum){
    console.log(`\n> GET: Looking up manga with name: \t${searchName}`);

    const paginationSize = 10;

    const endpoint = `https://api.mangadex.org/manga?` + 
        `title=${searchName}&` + 
        `limit=${paginationSize}&` + 
        `offset=${paginationNum * paginationSize}&` +
        `includes[]=cover_art`;
    https.request(endpoint, optionsMangaDex, (stream) => {
        buildJsonBody(stream, (mangaList) => {
            if (mangaList.result == 'error' || mangaList.data.length <= 0){
                writePage(res, "manga404.html");
                console.log(mangaList);
                return;
            }
            const {limit, offset, total} = mangaList;
            console.log({limit, offset, total});

            writePageManually(res, writeMangaListPage, {searchName, paginationNum, paginationSize, mangaList, total})

        });
    }).end();
}

function writeMangaListPage(res, params){
    const {searchName, paginationNum, paginationSize, mangaList, total} = params;

    res.write(`
        <main>
        <h1>Select your Manga</h1>
        <br>
        <form action='chapterSelect' method='GET' id="formList" class="mangaList">
            <input type='hidden' name='mangaId' id='mangaId'>
            <input type='hidden' name='mangaName' id='mangaName'>
            <input type='hidden' name='paginationNum' id='paginationNum' value=0>
    `);
    mangaList.data.forEach(manga => {
        const mangaName = manga.attributes.title[Object.keys(manga.attributes.title)[0]];
        let mangaDesc = manga.attributes.description.en;
        if (mangaDesc === undefined || mangaDesc === "") mangaDesc = "[English Description Not Found]"; 

        res.write(`
            <button type="submit" class="formBtn" data-id=${manga.id} data-name="${mangaName}">
                <div style="display: flex; gap: 20px;">
        `);

        if (manga.relationships[2].type == "cover_art"){
            const coverLink = manga.relationships[2].attributes.fileName;
            res.write(`<img src="https://uploads.mangadex.org/covers/${manga.id}/${coverLink}.256.jpg">`);
        }
        else res.write(`<img src="https://media.istockphoto.com/id/1147544807/vector/thumbnail-image-vector-graphic.jpg?s=612x612&w=0&k=20&c=rnCKVbdxqkjlcs3xH87-9gocETqpspHFXu5dIGB4wuM=">`);

        res.write(`
                    <div style="display: flex; flex-direction: column; gap: 10px;">
                        <b><p>${mangaName}</p></b>
                        <p>${mangaDesc}</p>
                    </div>
                </div>
            </button>
        `)
    }); 
    res.write(`
        </form> <br>
        <form action="mangaSelect" method="GET" style="display: flex; flex-direction: column; align-items: center;">
            <input type='hidden' name='name' value="${searchName}">
    `);
    writePagination(res, paginationNum, paginationSize, total);
    // res.end(`
    res.write(`
        </form>
        <script>
            document.getElementById('formList').addEventListener('submit', function(event) {
                const button = event.submitter; 
                if (button && button.classList.contains('formBtn')) {
                    const mangaId = button.dataset.id;
                    const mangaName = button.dataset.name;
                    document.getElementById('mangaId').value = mangaId;
                    document.getElementById('mangaName').value = mangaName;
                }
            });
        </script>
        </main>
    `);
}
    
function getChapter(res, mangaId, mangaName, paginationNum){
    process.stdout.write(`\n> GET: Fetching chapters of manga:\t`);
    console.log({mangaName, mangaId});

    const paginationSize = 20;

    const endpoint = 
        `https://api.mangadex.org/manga/${mangaId}/feed?`
        + `translatedLanguage[]=en&` 
        + `limit=${paginationSize}&`
        + `offset=${paginationNum * paginationSize}&`
        + `order[chapter]=asc`;
    https.request(endpoint, optionsMangaDex, (stream) => {
        buildJsonBody(stream, (chapterList) => {
            if (chapterList.result == 'error' || chapterList.data.length == 0){
                if (chapterList.data.length == 0 || chapterList.errors[0].status == 404){
                    writePage(res, "chapter404.html");
                }
                else quickResponse(res, 400, "400 Request For Chapter Failed");
                console.log(chapterList);
                return;
            }
            process.stdout.write("- ChapterList json metadata\t");

            const {limit, offset, total} = chapterList;
            console.log({limit, offset, total});
            chapterList.data.forEach(chap => console.log(`- Chapter ID:\t${chap.id}`));

            writePageManually(res, writeChapterListPage, {mangaId, mangaName, paginationNum, paginationSize, chapterList, total});
        });
    }).end();
}

function writeChapterListPage(res, params){
    const {mangaId, mangaName, paginationNum, paginationSize, chapterList, total} = params;
    
    res.write(`
        <main>
        <h1>Select your Chapter</h1>
        <br>
        <form action='finishSelection' method='GET' id="formList" class="chapterList" style="gap: 0px">
            <input type='hidden' name='chapterId' id='chapterId'>
            <input type='hidden' name='chapterNum' id='chapterNum'>
            <input type='hidden' name='mangaName' id='mangaName' value="${mangaName}">
            <input type='hidden' name='paginationNum' id='paginationNum' value=${paginationNum}>
    `);
    chapterList.data.forEach(chap => {
        let {volume, chapter, title} = chap.attributes;
        if (volume === null) volume = "[n/a]";
        if (chapter === null) chapter = "[n/a]";
        if (title === null) title = "[Title Not Found]"

        res.write(`
            <button type="submit" class="formBtn" data-cid=${chap.id} data-cnum=${chapter}>
                    <p>Vol. ${volume}</p> <p>Ch. ${chapter}</p> <p>${title}</p>
            </button>
        `);
    }); 
    res.write(`
        </form> <br>
        <form action="chapterSelect" method="GET" style="display: flex; flex-direction: column; align-items: center;">
            <input type='hidden' name='mangaId' id='mangaId' value=${mangaId}>
            <input type='hidden' name='mangaName' id='mangaName' value=${mangaName}>
    `);
    writePagination(res, paginationNum, paginationSize, total);
    res.write(`
        </form> 
        <script>
            document.getElementById('formList').addEventListener('submit', function(event) {
                const button = event.submitter; 
                if (button && button.classList.contains('formBtn')) {
                    const chapterId = button.dataset.cid;
                    const chapterNum = button.dataset.cnum;
                    document.getElementById('chapterId').value = chapterId;
                    document.getElementById('chapterNum').value = chapterNum;
                }
            });
        </script>
        </main>
    `);
}

function writePagination(res, paginationNum, paginationSize, total){
    let totalPages = Math.floor(total / paginationSize);
    totalPages = (total % paginationSize == 0) ? totalPages : totalPages + 1;
    res.write(`
        <br>    
        <p style="margin-bottom: 5px">Page ${paginationNum + 1}/${totalPages}  -  ${total} result(s) total</p>
        <div style="display: flex; justify-content: center; gap: 10px;">
    `);
    if (paginationNum > 0) res.write(`<button type="submit" name="paginationNum" value=${paginationNum - 1}><p>Prev Page</p></button>`);
    if (paginationNum + 1 < totalPages) res.write(`<button type="submit" name="paginationNum" value=${paginationNum + 1}><p>Next Page</p></button>`);
    res.write(`</div>`);
}

function getPages(res, chapterId, chapterNum, mangaName){
    console.log(`\n> GET: Fetching pages of chapter: \t${chapterId}`);

    const endpoint = `https://api.mangadex.org/at-home/server/${chapterId}`;
    https.request(endpoint, optionsMangaDex, (stream) => {
        buildJsonBody(stream, (pageList) => {
            if (pageList.result == 'error'){
                if (pageList.errors[0].status == 404) quickResponse(res, 404, "404 Chapter's Pages Not Found");
                else quickResponse(res, 400, "400 Request For Chapter's Pages Failed");
                console.log(pageList);
                return;
            }
            process.stdout.write("- RES<: PageList json metadata:\t");
            const baseUrl = pageList.baseUrl;
            const hash = pageList.chapter.hash;
            const size = pageList.chapter.data.length;
            console.log({baseUrl, hash, "NumberOfPages":size});
            console.log(pageList.chapter.data);

            const state = crypto.randomBytes(20).toString("hex");
            session.set(state, {pageList, chapterNum, mangaName});
            oAuthSignIn(res, state);
        });
    }).end();
}


// Google OAuth 2.0 ============================== 

const client_id = process.env.CLIENT_ID;
const client_secret = process.env.CLIENT_SECRET;
const redirect_uri = "http://localhost:3000/callback";
const response_type = "code";
const scope = "https://www.googleapis.com/auth/drive";

function oAuthSignIn(res, state){
    const endpoint = "https://accounts.google.com/o/oauth2/v2/auth";
    const uri = querystring.stringify({client_id, redirect_uri, response_type, scope, state});

    process.stdout.write("\n> RES>: OAuth Redirect Sent\t");
    console.log({client_id, redirect_uri, response_type, scope, state});

    res.writeHead(302, {Location: `${endpoint}?${uri}`});
    res.end();
}

function tokenExchange(res, code, state){
    const endpoint = 
        `https://oauth2.googleapis.com/token?`
        + `client_id=${client_id}&`
        + `client_secret=${client_secret}&`
        + `code=${code}&`
        + `redirect_uri=${redirect_uri}&`
        + `grant_type=authorization_code`;

    const options = {
        method: "POST",
        headers: {"Content-Type": "application/x-www-form-urlencoded"},
    };

    console.log("\n> POST: Token Exchange Initiated");
    https.request(endpoint, options, (stream) => {
        buildJsonBody(stream, (exchangeInfo) => {
            process.stdout.write(`- RES<: Exchange Complete\t`);
            
            if (exchangeInfo.error){
                quickResponse(res, 400, `OAuth Token Exchange Failure`);
                return;
            }

            const {access_token, expires_in, scope, token_type} = exchangeInfo;
            const shortened = access_token.substring(access_token.length - 9, access_token.length - 1);
            console.log({"access_token": `...${shortened}`, expires_in, scope, token_type});

            createFolder(res, access_token, state);
        });
    }).end();
}


// Download & Upload API Calls ==============================

function createFolder(res, token, state){
    const {pageList, chapterNum, mangaName} = session.get(state);

    const body = JSON.stringify({
        name: `${mangaName}, Ch. ${chapterNum + 1}`,
        mimeType: "application/vnd.google-apps.folder",
        parents: ["root"]
    });

    console.log("\n> POST: Creating Folder")
    
    const endpoint = "https://www.googleapis.com/drive/v3/files";
    const options = {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${token}`,
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(body)
        }
    };
    https.request(endpoint, options, (stream) => {
        buildJsonBody(stream, (folderRes) => {
            const folderId = folderRes.id;
            console.log("- RES<: Folder Created\n");

            // downloadPages(res, token, pageList, folderId, 0, 3); // download only 3 pages
            downloadPages(res, token, pageList, folderId, 0, pageList.chapter.data.length); 
        });
    }).end(body);
}

function downloadPages(res, token, pageList, folderId, pageNum, totalPages){
    const baseUrl = pageList.baseUrl;
    const chapterHash = pageList.chapter.hash;

    const pageCode = pageList.chapter.data[pageNum];
    const endpoint = `${baseUrl}/data/${chapterHash}/${pageCode}`;
    https.request(endpoint, optionsMangaDex, (stream) => {
        buildBinaryBody(stream, (body) => {
            const media = Buffer.from(body);
            // fs.writeFileSync(`${pageNum}.jpg`, media);

            console.log(`> GET: mangadex -> p.${pageNum + 1}`);

            uploadToDrive(res, token, media, folderId, pageList, pageNum, totalPages);
            
            pageNum++;
            if (pageNum < totalPages){
                downloadPages(res, token, pageList, folderId, pageNum, totalPages);
            }
        });
    }).end();
}

function uploadToDrive(res, token, media, folderId, pageList, pageNum, totalPages){
    const boundary = "314159265358979323846";
    const closingBoundary = `\r\n--${boundary}--\r\n`;
    
    const metadataPart = 
        `--${boundary}\r\n` +
        `Content-Type: application/json; charset=UTF-8\r\n` +
        `\r\n` +
        `${JSON.stringify({ name: pageNum + 1, mimeType: "image/jpg", parents: [folderId] })}\r\n`;

    const mediaPart_header = 
        `--${boundary}\r\n` +
        `Content-Type: image/jpg\r\n` +
        `\r\n`;

    const finalData = Buffer.concat([
        Buffer.from(metadataPart, "utf-8"),
        Buffer.from(mediaPart_header, "utf-8"),
        media,
        Buffer.from(closingBoundary, "utf-8")
    ]);

    const endpoint = "https://www.googleapis.com/upload/drive/v3/files?files?uploadType=multipart";
    const options = {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${token}`,
            "Content-Type": `multipart/related; boundary=${boundary}`,
            "Content-Length": finalData.length, 
        },
    };

    // console.log(`> POST: p.${pageNum + 1} -> drive`)
    https.request(endpoint, options, (stream) => {
        buildJsonBody(stream, (body) => {
            console.log(`> POST: p.${pageNum + 1} -> drive`)

            if (pageNum + 1 >= totalPages){
                const driveUrl = `https://drive.google.com/drive/folders/${folderId}`;
                res.writeHead(302, {Location: `${driveUrl}`});
                res.end();

                console.log("\n> RES<: All pages Uploaded to Drive");
                console.log(`- RES>: Redirecting client to Drive\t ${driveUrl}`);
            }
        });
    }).end(finalData);
}


// readStream handlers ============================== 

function buildJsonBody(stream, nextStep){
    let body = "";
    stream.on("data", (chunk) => body += chunk);
    stream.on("end", () => nextStep(JSON.parse(body)));
}

function buildBinaryBody(stream, nextStep){
    let data = [];
    stream.on('data', (chunk) => data.push(chunk));
    stream.on('end', () => nextStep(Buffer.concat(data)));
}