# Cloudflare Workers Backblaze Migrator
A Cloudflare Workers script to seamlessly migrate data from any source to [Backblaze B2](https://www.backblaze.com/b2/cloud-storage.html) while being served live from [Cloudflare](https://www.cloudflare.com/).

## Background

At [Agentpoint](https://www.agentpoint.com.au/) we've been using Amazon S3 to store our client's public files for many years and our S3 buckets have been growing rapidly with as of September, 2020 around 36 TB of storage and 380 million objects.

We had been using Cloudflare as the CDN for these files for years however the Amazon costs (especially bandwdith) are significant. That caused us to look around for alternative options which is when we found that Backblaze B2 could fit our use case well.

Then we had a problem: in order to migrate to Backblaze we needed to migrate all our data from Amazon. Moving hundreds of millions of objects would be quite a large undertaking and we couldn't afford to have downtime for these files as they get tens of thousands of hits a minute and new files are being added constantly.

That's when we realised Cloudflare Workers could do the hard work for us. That would let us to check each file as it's requested whether it's stored in Backblaze or not. If it's not stored with Backblaze then Cloudflare Workers is capable of uploading the file from Amazon S3 in to Backblaze B2 seamlessly behind the scenes while asynchronously serving the file to the visitor. This means we can migrate our objects from Amazon S3 to Backblaze B2 with their [S3 compatibility layer](https://www.backblaze.com/b2/docs/s3_compatible_api.html) as a single operation per request and not have to worry about migrating the data as a large task.

And since Backblaze and Cloudflare are both members of the [Bandwidth Alliance](https://www.cloudflare.com/en-au/bandwidth-alliance/) this has both dropped our bandwidth costs to zero and we also only have to pay the Amazon S3 transfer cost at the same time as serving the image to the user anyway - Backblaze and Cloudflare don't charge us anything for migrating the data!

Due to how this is implemented, it can be used to migrate from any source to Backblaze B2 from other object storage providers or even to assist with migrating from on-premises data storage. The only requirement is the source has to be publicly accessible over HTTP.

## Setup

1. Firstly ensure you have a Cloudflare and a Backblaze B2 account set up.
2. Create a B2 Bucket, and an App Key with write permission to the bucket. Note down the Bucket ID, Key ID and App Key.
3. Create a new Cloudflare Worker, give it a name and paste in the contents of cloudflare-b2-worker.js.
4. Add a new route pointing to the worker. If you have a dedicated subdomain for serving assets then it would be similar to "cdn.example.com/*"
5. Create a new Workers KV namespace. This will be used to store a single value for Backblaze's upload details.
6. In the Worker Settings create a KV Namespace Binding with the variable name "B2CREDENTIALS"
7. Create the following environment variables:
 - *KEY_ID* - Your B2 Key ID
 - *APP_KEY* - Your B2 App Key
 - *BUCKET_ID* - Your B2 Bucket ID
 - *B2_BUCKET_URL* - The public URL to your bucket (for example https://f002.backblazeb2.com/file/bucket-name/
 - *BACKUP_URL* - This can be any publicly available url. The requested path will be appended on the end (for example https://bucket-name.s3.amazonaws.com/)
8. Congratulations, your worker should be live and migrating files

## Method of Operation

When the worker receives a new request it first tries requesting the file from the B@_BUCKET_URL. If the request succeeds then no further processing is done and the result is sent back to the browser.

If Backblaze does not have the file, then the same request is sent to the BACKUP_URL. If this also fails then the error is returned to the browser.

If the backup url succeeds then the result is immediately passed to the browser. Using event.waitUntil() the process to migrate the file to Backblaze B2 does not delay the file load time to the browser. The upload process handles ensuring the Backblaze upload token is up to date (stored in Workers KV) and uploads the file.

## Other Considerations

It is possible but unlikely for a file to be deleted while it is accessed. This may result in orphaned files being retained in Backblaze B2. Whether this is a problem or not depends on the application and could be mitigated by logging deletes.

Also if there are many rarely accessed objects then (depending on business requirements) a separate process may be needed to force these to be migrated. This can be done weeks or months after the Worker script has been deployed to reduce the amount of files that need to be copied manually. This separate process could be sped up significantly and done for a fraction of the cost by simply sending HTTP HEAD requests to Cloudflare and letting the Worker handle moving the file which saves having to download and reupload the files.

## License

This code is released under the GNU General Public License version 3.
