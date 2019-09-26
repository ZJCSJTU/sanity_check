const CDP = require('chrome-remote-interface');
const fs = require('fs');

/*
  This crawler will count the number of requests and responses in every 3000 ms, 
  and if nothing happens during the past 3 seconds, then stop.
*/


// var requestCounterMinWaitMs = 5000;
var requestCounterMaxWaitMs = 15000;
// var theUrl = 'https://ip.topicbox.com/groups/ip/T81c6f00ff0059d34';

const outputDir = process.argv[2];
const pageId = process.argv[3];
const theUrl = process.argv[4];
const portNum = parseInt(process.argv[5], 10);

const responseOutputStream = fs.createWriteStream(outputDir + 'response_output' + pageId, { flags: 'a' });
const requestOutputStream = fs.createWriteStream(outputDir + 'request_output' + pageId, { flags: 'a' });
const initiatorOutputStream = fs.createWriteStream(outputDir + 'request_initiator' + pageId, { flags: 'a' });


// var theUrl = process.argv[2];
// var outputFilename = process.argv[3];

// count the number of sent requests and received responses
var numSent = 0;
var numReceived = 0;
var startTime = new Date().getTime();

// this set stores the sent out request IDs, upon receiving responses, remove the corresponding ID
var pageRequestIDs = new Set();

// function minWaitTimeExceeded() {
//   return new Date().getTime() - startTime > requestCounterMinWaitMs;
// }

function maxWaitTimeExceeded() {
  return new Date().getTime() - startTime > requestCounterMaxWaitMs;
}

// this crawler will use port 9221
const options = {
  port: portNum
}

// get the HTML of the web page.
// Deprecated.
async function getHtml(client) {
  var outputFilename = outputDir + 'page' + pageId + '.html';
  // clearInterval(ajaxDoneInterval);
  var pageContents;
  // write to file the page HTML 
  client.Runtime.evaluate({expression: 'let counter = 0; \
    let allImgs = document.getElementsByTagName(\'img\');\
    for (let img of allImgs) {\
      img.setAttribute(\'img-idx\', counter);\
      counter += 1;\
    }\
    document.documentElement.outerHTML'}, (error, result) => {
      pageContents = result.result.value;
      fs.writeFile(outputFilename, pageContents, (err) => {
        if(err) {
            return console.log(err);
        }
      });
      // client.close();
  });
}

// get dimension of the document and images
// Deprecated.
async function getDimension(client) {
  const re = await client.Runtime.evaluate({
    expression: 'function getDocSize() {let doc = document.body;\
    let bodyRect = document.body.getBoundingClientRect(); \
    let docSize = {height: doc.scrollHeight, width: doc.scrollWidth, \
        left: bodyRect.left, right: bodyRect.right, top: bodyRect.top, bottom: bodyRect.bottom}; return docSize;} getDocSize();',
    returnByValue: true 
  });

  const res = await client.Runtime.evaluate({
    expression: 'function getImages() {\
        let allimg = document.getElementsByTagName(\'img\');\
        for (let img of allimg) {\
            img.scrollIntoView();\
        }\
        let images = document.getElementsByTagName(\'img\');\
        let retImages = [];\
        for (let image of images) {\
            let p = image.parentElement;\
            let pp = image.parentElement.parentElement;\
            let pNode = image.parentElement.nodeName;\
            let ppNode = image.parentElement.parentElement.nodeName;\
            let pUrl = \'NONE\';\
            let ppUrl = \'NONE\';\
            if (pNode == \'A\') {\
                pUrl = p.href;\
                if (pUrl == \'\') {\
                    pUrl = p.rel;\
                }\
            }\
            if (ppNode == \'A\') {\
                ppUrl = pp.href;\
                if (ppUrl == \'\') {\
                    ppUrl = pp.rel;\
                }\
            }\
            let imageRect = image.getBoundingClientRect();\
            let idx = image.getAttribute(\'img-idx\');\
            imgInfo = {index: idx, url: image.src, height: image.clientHeight, width: image.clientWidth,\
                left: imageRect.left, right: imageRect.right, top: imageRect.top, bottom: imageRect.bottom,\
                p: pNode, pp: ppNode, purl: pUrl, ppurl: ppUrl};\
            retImages.push(imgInfo);\
        }\
        return retImages;\
    }\
    getImages();',
    returnByValue: true 
  });

  let outputString = 'DOC URL\tHEIGHT\tWIDTH\tLEFT\tRIGHT\tTOP\tBOTTOM\n';
  outputString += (theUrl + '\t' + re.result.value.height + '\t' + re.result.value.width + '\t');
  outputString += (re.result.value.left + '\t' +  re.result.value.right + '\t' +  re.result.value.top + '\t' +  re.result.value.bottom + '\n')

  outputString += 'IMAGE URL\tHEIGHT\tWIDTH\tLEFT\tRIGHT\tTOP\tBOTTOM\tPNODE\tPURL\tPPNODE\tPPURL\n';
  for (let img of res.result.value) {
      outputString += (img.index + '\t' + img.url + '\t' + img.height + '\t' + img.width + '\t');
      outputString += (img.left + '\t' + img.right + '\t' + img.top + '\t' + img.bottom + '\t');
      outputString += (img.p + '\t' + img.purl + '\t' + img.pp + '\t' + img.ppurl + '\n');
  }

  // write image dimension information to a file
  fs.writeFile(outputDir + 'image_info' + pageId + '.tsv', outputString, (err) => {
    if(err) {
        return console.log(err);
    }
  });
}


CDP(options, (client) => {
    const {DOM, Network, Page} = client;
    // setup handlers
    Network.requestWillBeSent((params) => {
      const reqType = params.type;
      // get the initiator here
      const initiator = JSON.stringify(params.initiator)
      initiatorOutputStream.write(reqType + '\t' + initiator + '\n');

      // also log the request here.
      const reqOut = JSON.stringify(params.request);
      requestOutputStream.write(reqType + '\t' + reqOut + '\n');
      // console.log('Sent ' + params.type); 
      pageRequestIDs.add(params.requestId) 
      ++numSent;
    });
    Network.responseReceived((params) => {
      const respOut = JSON.stringify(params.response);
      const type = params.type;
      responseOutputStream.write(type + '\t' + respOut + '\n');
      
      // console.log('Recieved ' + params.type);
      if (pageRequestIDs.has(params.requestId)) {
        // remove that ID
        pageRequestIDs.delete(params.requestId)
      }
      else {
        // console.log('Received unexpected responses from ??')
      }
      ++numReceived;
    });
    Page.loadEventFired(() => {
      // set time interval 3000 ms
      var ajaxDoneInterval = setInterval(async function() {
        if (maxWaitTimeExceeded()) {
          // console.log('Timed out. Waited ' + (new Date().getTime() - startTime) + ' ms. Give up.');
          clearInterval(ajaxDoneInterval);
          const {root: {nodeId: documentNodeId}} = await client.DOM.getDocument();
          const {nodeId: bodyNodeId} = await client.DOM.querySelector({
            selector: 'body',
            nodeId: documentNodeId,
          });
          const {model: {height}} = await client.DOM.getBoxModel({nodeId: bodyNodeId});
  
          console.log("Set visible size to the height of the dom", height);
  
          const deviceMetrics = {
          width: 1280,
          height: height,
          deviceScaleFactor: 1,
          mobile: false,
          fitWindow: false,
          };
          await client.Emulation.setDeviceMetricsOverride(deviceMetrics);
          await client.Emulation.setVisibleSize({width: 1280, height: height});
          // await client.Input.synthesizeScrollGesture({ x: 0, y: 0, yDistance: -height})
          
          try{
            const result = await client.Runtime.evaluate({
              expression: 'let counter = 0; \
            let allImgs = document.getElementsByTagName(\'img\');\
            for (let img of allImgs) {\
                img.setAttribute(\'img-idx\', counter);\
                counter += 1;\
            }\
            document.documentElement.outerHTML'
            });

            // get the dimension of the whole document
            const re = await client.Runtime.evaluate({
              expression: 'function getDocSize() {let doc = document.body;\
            let bodyRect = document.body.getBoundingClientRect(); \
            let docSize = {height: doc.scrollHeight, width: doc.scrollWidth, \
                left: bodyRect.left, right: bodyRect.right, top: bodyRect.top, bottom: bodyRect.bottom}; return docSize;} getDocSize();',
              returnByValue: true
            });

            let linksString = '';
            const resp = await client.Runtime.evaluate({
              expression: ' function getSiteUrls() {\
                links = document.getElementsByTagName(\'a\');\
                let retLinks = [];\
                for (let link of links) {\
                    retLinks.push(link.href);\
                }\
                return retLinks;\
             }\
             getSiteUrls();',
              returnByValue: true
            });

            linksString += ('PAGE URL: ' + theUrl + '\n');
            links = resp.result.value
            for (let link of links) {
              linksString += (link + '\n');
            }

            // console.log(re.result)
            let outputString = 'DOC URL\tHEIGHT\tWIDTH\tLEFT\tRIGHT\tTOP\tBOTTOM\n';
            outputString += (theUrl + '\t' + re.result.value.height + '\t' + re.result.value.width + '\t');
            outputString += (re.result.value.left + '\t' + re.result.value.right + '\t' + re.result.value.top + '\t' + re.result.value.bottom + '\n')

            // get the dimensions of each image on the screen
            // the injected code is from analyze-images.js
            const res = await client.Runtime.evaluate({
              expression: 'function getImages() {\
            let allimg = document.getElementsByTagName(\'img\');\
            for(let img of allimg) {\
                img.scrollIntoView();\
            }\
    let images = document.getElementsByTagName(\'img\');\
            let retImages =[];\
            for(let image of images) {\
                let p = image.parentElement;\
                let pUrl = \'NONE\';\
                while (p != null) {\
                    if (p.nodeName == \'A\') {\
                        pUrl = p.href;\
                        if (pUrl == \'\') {\
                            pUrl = p.rel;\
                        }\
                        break;\
                    }\
                    p = p.parentElement;\
                }\
                let imageRect = image.getBoundingClientRect();\
                let idx = image.getAttribute(\'img-idx\');\
                imgInfo = {\
                    index: idx, url: image.src, height: image.clientHeight, width: image.clientWidth,\
                    left: imageRect.left, right: imageRect.right, top: imageRect.top, bottom: imageRect.bottom,\
                    pUrl: pUrl\
                };\
                retImages.push(imgInfo);\
            }\
    return retImages;\
        }\
    getImages();\
            ',
              returnByValue: true
            });
            outputString += 'IMAGE URL\tHEIGHT\tWIDTH\tLEFT\tRIGHT\tTOP\tBOTTOM\tPNODE\tPURL\tPPNODE\tPPURL\n';
            for (let img of res.result.value) {
              outputString += (img.index + '\t' + img.url + '\t' + img.height + '\t' + img.width + '\t');
              outputString += (img.left + '\t' + img.right + '\t' + img.top + '\t' + img.bottom + '\t');
              outputString += (img.pUrl + '\n');
            }
            const html = result.result.value;

            // Need to write to a pageID and not a URL because URLs will have invalid filenames
            fs.writeFile(outputDir + 'full_html' + pageId + '.html', html, (err) => {
              if (err) {
                return console.log(err);
              }
            });
            // write image dimension information to a file
            fs.writeFile(outputDir + 'image_info' + pageId + '.tsv', outputString, (err) => {
              if (err) {
                return console.log(err);
              }
            });
            // write the links to a file
            fs.writeFile(outputDir + 'links' + pageId + '.txt', linksString, (err) => {
              if (err) {
                return console.log(err);
              }
            });
          } catch (err) {
            console.log(err)
          } finally {
            console.log('Crawled url' + pageId)
            client.close();
          }
        }
        else if (numSent == 0 && numReceived == 0 ) {
          // console.log('No request or response during the past 3 seconds, stop waiting.')
          // console.log(pageRequestIDs.size + ' requests never receive any responses.')
          clearInterval(ajaxDoneInterval);

          const {root: {nodeId: documentNodeId}} = await DOM.getDocument();
          const {nodeId: bodyNodeId} = await DOM.querySelector({
            selector: 'body',
            nodeId: documentNodeId,
          });
          const {model: {height}} = await DOM.getBoxModel({nodeId: bodyNodeId});
  
          console.log("Set visible size to the height of the dom", height);
  
          const deviceMetrics = {
            width: 1280,
            height: height,
            deviceScaleFactor: 1,
            mobile: false,
            fitWindow: false,
          };
          await client.Emulation.setDeviceMetricsOverride(deviceMetrics);
          await client.Emulation.setVisibleSize({width: 1280, height: height});
          
          try {   
            const result = await client.Runtime.evaluate({
              expression: 'let counter = 0; \
            let allImgs = document.getElementsByTagName(\'img\');\
            for (let img of allImgs) {\
                img.setAttribute(\'img-idx\', counter);\
                counter += 1;\
            }\
            document.documentElement.outerHTML'
            });

            // get the dimension of the whole document
            const re = await client.Runtime.evaluate({
              expression: 'function getDocSize() {let doc = document.body;\
            let bodyRect = document.body.getBoundingClientRect(); \
            let docSize = {height: doc.scrollHeight, width: doc.scrollWidth, \
                left: bodyRect.left, right: bodyRect.right, top: bodyRect.top, bottom: bodyRect.bottom}; return docSize;} getDocSize();',
              returnByValue: true
            });

            let linksString = '';
            const resp = await client.Runtime.evaluate({
              expression: ' function getSiteUrls() {\
                links = document.getElementsByTagName(\'a\');\
                let retLinks = [];\
                for (let link of links) {\
                    retLinks.push(link.href);\
                }\
                return retLinks;\
             }\
             getSiteUrls();',
              returnByValue: true
            });

            linksString += ('PAGE URL: ' + theUrl + '\n');
            links = resp.result.value
            for (let link of links) {
              linksString += (link + '\n');
            }

            // console.log(re.result)
            let outputString = 'DOC URL\tHEIGHT\tWIDTH\tLEFT\tRIGHT\tTOP\tBOTTOM\n';
            outputString += (theUrl + '\t' + re.result.value.height + '\t' + re.result.value.width + '\t');
            outputString += (re.result.value.left + '\t' + re.result.value.right + '\t' + re.result.value.top + '\t' + re.result.value.bottom + '\n')

            // get the dimensions of each image on the screen
            // the injected code is from analyze-images.js
            const res = await client.Runtime.evaluate({
              expression: 'function getImages() {\
            let allimg = document.getElementsByTagName(\'img\');\
            for(let img of allimg) {\
                img.scrollIntoView();\
            }\
    let images = document.getElementsByTagName(\'img\');\
            let retImages =[];\
            for(let image of images) {\
                let p = image.parentElement;\
                let pUrl = \'NONE\';\
                while (p != null) {\
                    if (p.nodeName == \'A\') {\
                        pUrl = p.href;\
                        if (pUrl == \'\') {\
                            pUrl = p.rel;\
                        }\
                        break;\
                    }\
                    p = p.parentElement;\
                }\
                let imageRect = image.getBoundingClientRect();\
                let idx = image.getAttribute(\'img-idx\');\
                imgInfo = {\
                    index: idx, url: image.src, height: image.clientHeight, width: image.clientWidth,\
                    left: imageRect.left, right: imageRect.right, top: imageRect.top, bottom: imageRect.bottom,\
                    pUrl: pUrl\
                };\
                retImages.push(imgInfo);\
            }\
    return retImages;\
        }\
    getImages();\
            ',
              returnByValue: true
            });
            outputString += 'IMAGE URL\tHEIGHT\tWIDTH\tLEFT\tRIGHT\tTOP\tBOTTOM\tPNODE\tPURL\tPPNODE\tPPURL\n';
            for (let img of res.result.value) {
              outputString += (img.index + '\t' + img.url + '\t' + img.height + '\t' + img.width + '\t');
              outputString += (img.left + '\t' + img.right + '\t' + img.top + '\t' + img.bottom + '\t');
              outputString += (img.pUrl + '\n');
            }
            const html = result.result.value;

            // Need to write to a pageID and not a URL because URLs will have invalid filenames
            fs.writeFile(outputDir + 'full_html' + pageId + '.html', html, (err) => {
              if (err) {
                return console.log(err);
              }
            });
            // write image dimension information to a file
            fs.writeFile(outputDir + 'image_info' + pageId + '.tsv', outputString, (err) => {
              if (err) {
                return console.log(err);
              }
            });
            // write the links to a file
            fs.writeFile(outputDir + 'links' + pageId + '.txt', linksString, (err) => {
              if (err) {
                return console.log(err);
              }
            });
            
          } catch (err) {
            console.error(err);
          } finally {
            console.log('Crawled url' + pageId)
            client.close();
          }
        }
        else {
          // console.log('In 3 seconds, sent ' + numSent + ' requests, and received ' + numReceived + ' responses.')
          // console.log('Will wait for another 3 seconds and re-count the requests and responses.')
          numReceived = 0;
          numSent = 0;
        }
      }, 3000);
    });
    // enable events then start
    Promise.all([
        Network.enable(),
        Page.enable()
    ]).then(async() => {
        return Page.navigate({url: theUrl});

    }).catch((err) => {
        console.error(err);
        client.close();
    });
}).on('error', (err) => {
    console.error(err);
});
