require('dotenv').config()
const { S3Client, PutObjectCommand, HeadObjectCommand } = require("@aws-sdk/client-s3");
const fs = require("fs");
const path = require("path");
const mime = require("mime-types");
const { createObjectCsvWriter } = require("csv-writer");
const readline = require("readline");


// AWS Configuration (Environment Variables)
const REGION = process.env.AWS_REGION;
const BUCKET = process.env.S3_BUCKET;
const FOLDER = process.env.S3_FOLDER;
const INPUT_DIR = path.join(__dirname, 'images');

// S3 Client
const s3 = new S3Client({
    region: REGION,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
  });


// Ask the user a yes/no question in the terminal, resolve to true for "y"/"yes"
function askYesNo(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(['y', 'yes'].includes(answer.trim().toLowerCase()));
    });
  });
}

// Check whether an object already exists at the given key in S3
async function objectExists(key) {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    return true;
  } catch (error) {
    if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
      return false;
    }
    throw error;
  }
}

// Upload a single file to S3, return both the S3 URI and the object URL
async function uploadFile(fileName) {
  const filePath = path.join(INPUT_DIR, fileName);

  //async read the file
  const body = fs.readFileSync(filePath);
  const contentType = mime.lookup(filePath) || 'application/octet-stream';
  const key = `${FOLDER}/${fileName}`;

  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: body,
    ContentType: contentType,
  }));

  // Encode each path segment (but not the "/" separators) so spaces and other
  // special characters resolve correctly when the URL is opened in a browser
  const encodedKey = key.split('/').map(encodeURIComponent).join('/');

  return {
    s3Uri: `s3://${BUCKET}/${key}`,
    url: `https://${BUCKET}.s3.${REGION}.amazonaws.com/${encodedKey}`,
  };
}

// loop through all files in images/ dir one at a time (using await so each upload should finish before the next starts). Each file success/error should be caught individually so one failed upload doesnt stop the loop. 
async function main() {
  const files = fs.readdirSync(INPUT_DIR).filter((f) => !f.startsWith('.'));
  const succeded = [];
  const failed = [];
  const duplicate = [];

  for (const file of files) {
    try {
      const key = `${FOLDER}/${file}`;
      if (await objectExists(key)) {
        duplicate.push(file);
        continue;
      }

      const { s3Uri, url } = await uploadFile(file);
      succeded.push({ fileName: file, s3Uri, url });
      console.log(`${file} uploaded successfully`);
    } catch (error) {
      failed.push({ fileName: file, error: error.message });
      console.log(`${file} failed to upload: ${error.message}`);
    }
  }

  if (duplicate.length > 0) {
    console.log('These image names are already uploaded. Please review and reupload with a different name:');
    duplicate.forEach((fileName) => console.log(`- ${fileName}`));

    const shouldOverwrite = await askYesNo('Would you like to overwrite these files instead? (y/n): ');
    if (shouldOverwrite) {
      for (const file of duplicate) {
        try {
          const { s3Uri, url } = await uploadFile(file);
          succeded.push({ fileName: file, s3Uri, url });
          console.log(`${file} overwritten successfully`);
        } catch (error) {
          failed.push({ fileName: file, error: error.message });
          console.log(`${file} failed to overwrite: ${error.message}`);
        }
      }
      duplicate.length = 0;
    }
  }

  const csvWriter = createObjectCsvWriter({
    path: 'uploads.csv',
    header: [
      { id: 'fileName', title: 'File Name' },
      { id: 's3Uri', title: 'S3 URI' },
      { id: 'url', title: 'URL' },
    ],
  });
  await csvWriter.writeRecords(succeded);
  console.log('Uploads completed successfully');
  console.log(`${succeded.length} files uploaded successfully`);
  if (failed.length > 0) {
    console.log(`${failed.length} files failed to upload`);
  }
  if (duplicate.length > 0) {
    console.log(`${duplicate.length} files skipped due to duplicate names`);
  }

}
main().catch(error => {
  console.error('Error:', error);
  process.exit(1);
});