require('dotenv').config()
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const fs = require("fs");
const path = require("path");
const mime = require("mime-types");
const { createObjectCsvWriter } = require("csv-writer");


// AWS Configuration (Environment Variables)
const REGION = process.env.AWS_REGION;
const BUCKET = process.env.S3_BUCKET;
const FOLDER = process.env.S3_FOLDER;
const INPUT_DIR = path.join(__dirname, 'images');

// S3 Client
const s3 = new S3Client({
    region: REGION,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
  });


// Upload a single file to S3, return URL
async function uploadFile(fileName) {
  const filePath = path.join(INPUT_DIR, fileName);
  const body = fs.readFileSync(filePath);
  const contentType = mime.lookup(filePath) || 'application/octet-stream';
  const key = `${FOLDER}/${fileName}`;

  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: body,
    ContentType: contentType,
  }));
  return `https://${BUCKET}.s3.${REGION}.amazonaws.com/${key}`;

}

// loop through all files in images/ dir one at a time (using await so each upload should finish before the next starts). Each file success/error should be caught individually so one failed upload doesnt stop the loop. 
async function main() {
  const files = fs.readdirSync(INPUT_DIR).filter((f) => !f.startsWith('.'));
  const succeded = [];
  const failed = [];

  for (const file of files) {
    try {
      const url = await uploadFile(file);
      succeded.push({ fileName: file, url });
      console.log(`${file} uploaded successfully`);
    } catch (error) {
      failed.push({ fileName: file, error: error.message });
      console.log(`${file} failed to upload: ${error.message}`);
    }
  }

  const csvWriter = createObjectCsvWriter({
    path: 'uploads.csv',
    header: [
      { id: 'fileName', title: 'File Name' },
      { id: 'url', title: 'URL' },
    ],
  });
  await csvWriter.writeRecords(succeded);
  console.log('Uploads completed successfully');
  console.log(`${succeded.length} files uploaded successfully`);
  if (failed.length > 0) {
    console.log(`${failed.length} files failed to upload`);
  }


}
main().catch(error => {
  console.error('Error:', error);
  process.exit(1);
});