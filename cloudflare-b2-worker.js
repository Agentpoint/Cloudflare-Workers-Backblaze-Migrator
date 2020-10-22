// Define the following environment variables in Cloudflare
// BUCKET_ID - The destination B2 Bucket ID
// KEY_ID - A B2 Key ID
// APP_KEY - The matching key for KEY_ID
// B2_BUCKET_URL - The public URL to the B2 Bucket
// BACKUP_URL - The public backup URL to try if B2 does not have a file

const b2Api = 'https://api.backblazeb2.com/b2api/v1/';

// Helper functions to access Cloudflare KV for caching upload details
// Details cached for 12 hours. Name the KV variable name B2CREDENTIALS
const setCache = (data, ttl) => B2CREDENTIALS.put('b2', data, {expirationTtl: 3600 * 12})
const getCache = () => B2CREDENTIALS.get('b2')

const cloudflareCacheSettings = { cacheTtl: 14400 };

addEventListener('fetch', event => {
  event.respondWith(handleRequest(event));
})

async function handleRequest(event) {
  let request = event.request;
  let path = (new URL(request.url).pathname).substring(1); // Identify the file being requested, remove initial /
  console.log(path);

  // Fetch the file from Backblaze
  var response = await fetch(B2_BUCKET_URL + path, { cf: cloudflareCacheSettings, 'headers': request.headers });
  
  if (!response.ok) { // 4xx or 5xx response recieved
    console.log("File not found in B2, trying backup");
    
    // Fetch the file from the backup URL
    response = await fetch(BACKUP_URL + path, { cf: cloudflareCacheSettings, 'headers': request.headers });

    if (response.ok) { // We have the file from the backup
        console.log("File found in backup, try to move to B2");
        let uploadCopy = response.clone(); // Clone the response as it can't be used twice
        
        // Use waitUntil so uploading to B2 is done async to serving the file to the user
        event.waitUntil(uploadFile(uploadCopy, path));
    } else {
        // File not found in either B2 or the backup url
        console.log('File also not found in backup');
    }
  } else {
      // File found in B2 so no need to access the backup url
      console.log("File found in B2")
  }

  // Apply some custom headers to the response
  response = new Response(response.body, response);
  response.headers.set("Cache-Control", "public, max-age=3600, stale-while-revalidate=3600, stale-if-error=86400");

  return response;
}

// Fetch required tokens and urls for B2, cached if possible in Cloudflare KV
async function getB2() {
    const cache = await getCache();
    if (!cache) { // No valid cache, fetch new tokens and upload url
        console.log('B2 Keys Cache Miss');
        
        let headers = {
            'Authorization': 'Basic ' + btoa(KEY_ID + ':' + APP_KEY),
        };
        let url = b2Api + 'b2_authorize_account';
        let cache = {
            token: '',
            apiurl: '',
            uploadurl: '',
            uploadtoken: '',
        };
        
        // First need to call b2_authorize_account
        let accessResponse = await fetch(url, { 'headers': headers });
        
        if (accessResponse.ok) {
            let data = await accessResponse.json();
            console.log("Authorized");
            
            cache.token = data['authorizationToken'];
            cache.apiurl = data['apiUrl'];
            
            let headers = {
                'Authorization': cache.token,
            };
            let url = cache.apiurl + '/b2api/v2/b2_get_upload_url';

            // Next we need to call b2_get_upload_url to get upload details
            let uploadResponse = await fetch(url, {
                'headers': headers,
                'method': 'POST',
                'body': JSON.stringify({'BUCKET_ID': BUCKET_ID})
            });

            if (uploadResponse.ok) {
                console.log("UploadUrl Fetched");
                let data = await uploadResponse.json();
                cache.uploadtoken = data['authorizationToken'];
                
                if (data['uploadUrl'].length > 0) {
                    cache.uploadurl = data['uploadUrl'];

                    await setCache(JSON.stringify(cache));
                    return cache;
                }
            } else {
                // Getting the upload url failed
                console.log('Upload URL Failed');
                console.log(uploadResponse.status);
            }
        } else {
            // Initial authorization failed
            console.log('Auth failed');
            console.log(accessResponse.status);
        }

        return false;
    } else {
        // We have a cache hit so re-use previous details
        console.log('B2 Keys Cache Hit');
        return JSON.parse(cache);
    }
}

// Upload a file to B2, takes a response object and the requested file path
async function uploadFile(fileUpload, path) {
    // Need to copy the original details
    // Note: The source Content-Length is used so if the data is truncated then the upload will fail
    const contentType = fileUpload.headers.get("Content-Type");
    const contentLength = fileUpload.headers.get('Content-Length');
    
    const b2 = await getB2(); // Get upload credentials
    const buffer = await fileUpload.arrayBuffer();
    const hash = await digestBuffer(buffer); // SHA1 hash the data as a safety measure
    
    const headers = {
        'Authorization': b2.uploadtoken,
        'X-Bz-File-Name': path,
        'Content-Type': contentType,
        'Content-Length': contentLength,
        'X-Bz-Content-Sha1': hash,
    };
    
    let response = await fetch(b2.uploadurl, {
        'method': 'POST',
        'headers': headers,
        'body': buffer,    
    });
    
    if (response.ok) {
        // Successfully uploaded the file to B2
        console.log("Successful upload");
        return true;
    } else {
        // Something went wrong
        console.log("Upload failed");
        console.log(headers);
        console.log(await response.text());
        return false;
    }
}

// Helper function to get a hex SHA1 hash of a buffer
async function digestBuffer(buffer) {
    const hashBuffer = await crypto.subtle.digest("SHA-1", buffer)
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}
