```
import { Collections } from 'constants';

import fs from 'fs';
import path from 'path';

import Stripe from 'stripe';

import { nanoid } from 'nanoid';

import sgMail from '@sendgrid/mail';

import XLSX from 'xlsx';

import { config, logger, db, HttpsError, bucket } from 'utils/firebase';

export const stripe = new Stripe(config.stripe.secret);

const FILE_NAME = 'records.csv';

async function storeFile(data) {
  try {
    const workSheet = await XLSX.utils.json_to_sheet(data);
    const workBook = await XLSX.utils.book_new();
    await XLSX.utils.book_append_sheet(workBook, workSheet, 'students');
    const buffer = await XLSX.write(workBook, { bookType: 'csv', type: 'buffer' });
    return buffer;
    // await XLSX.write(workBook, { bookType: 'csv', type: 'binary' });
    // await XLSX.writeFile(workBook, FILE_NAME);
    // return true;
  } catch (e) {
    throw new HttpsError('UNABLE_TO_STORE_FILE', e);
  }
}

async function uploadFile(title, buffer) {
  let fileUploaded = false;
  let fileLink = null;
  const uuid = nanoid();
  const bucketName = bucket.name;
  try {
    // upload(FILE_NAME,fn)
    const file = await bucket.upload(buffer, {
      destination: `livestream-excel-sheets/${title}_${uuid}_${FILE_NAME}`,
      uploadType: 'media',
      metadata: {
        contentType: 'text/csv',
        metadata: {
          firebaseStorageDownloadTokens: uuid,
        },
      },
    });
    fileLink = `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(
      file[0]?.name
    )}?alt=media&token=${uuid}`;
    fileUploaded = true;
  } catch (e) {
    throw new HttpsError('UNABLE_TO_UPLOAD_FILE', e);
  }
  return { fileLink, fileUploaded };
}

// async function deleteFile() {
//   const pathToFile = path.join(__dirname, `../../functions/${FILE_NAME}`);
//   const err = await fs.promises.unlink(pathToFile);
//   if (err) throw new HttpsError('UNABLE_TO_DELETE_FILE', err);
//   return true;
// }

async function getExcelSheetLink(data, title) {
  const fileStored = await storeFile(data);
  if (!fileStored) return null;
  const { fileLink, fileUploaded } = await uploadFile(title, fileStored);
  if (!fileUploaded) return null;
  // const fileDeleted = await deleteFile();
  // if (!fileDeleted) return null;
  return fileLink;
}

sgMail.setApiKey(config.sendgrid.apikey);

export default async function postLiveStreamTask(data) {
  const { streamDocId } = data;
  try {
    const liveStreamDocRef = db.collection(Collections.liveStreams).doc(streamDocId);
    const liveStreamDoc = await liveStreamDocRef.get();
    const { title, userId, totalViews, uniqueViewers } = liveStreamDoc.data();

    const ordersQuery = await db
      .collection(Collections.orders)
      .where('status', '==', 'success')
      .where('product.streamId', '==', streamDocId);
    const { docs } = await ordersQuery.get();

    const result = [];
    let totalAmount = 0;

    if (docs.length) {
      for (const order of docs) {
        const orderData = order.data();
        const buyerId = orderData.userId;
        if (buyerId) {
          const buyerSnapshot = await db
            .collection(Collections.users)
            .doc(buyerId)
            .get();
          if (buyerSnapshot.exists) {
            const resultObj = {};
            resultObj['Order ID'] = order.id;
            resultObj['Product Name'] = orderData.product.name;
            resultObj['Product SKU'] = orderData.product.sku;
            const stripePaymentIntentData = await stripe.paymentIntents.retrieve(orderData.paymentId);
            const { line1, line2, city, state, country, postalCode } = stripePaymentIntentData.shipping.address;
            resultObj["Buyer's Address"] = `${line1} ${line2 ?? ` , ( ${line2} ) `} , ${city} , ${state} , ${country} ${
              postalCode ? `- ${postalCode}` : ''
            }`;
            resultObj["Buyer's Phone Number (Optional)"] = stripePaymentIntentData.shipping.phone;
            const buyer = buyerSnapshot.data();
            resultObj.Username = buyer.userName;
            resultObj.DisplayName = buyer.displayName;
            resultObj.userId = buyerId;
            totalAmount += orderData.product.price / 100;
            result.push(resultObj);
          }
        }
      }
    }

    result.sort((a, b) => (a.userId < b.userId ? 1 : -1));
    // eslint-disable-next-line no-param-reassign
    result.forEach(resultObj => delete resultObj.userId);

    const excelFileSheetLink = await getExcelSheetLink(result, title);

    // const seller = await admin.auth().getUser(userId);
    const seller = (
      await db
        .collection(Collections.users)
        .doc(userId)
        .get()
    ).data();

    const templateData = {
      title,
      displayName: seller?.displayName ?? seller?.userName ?? seller?.email,
      productsSold: docs.length,
      totalAmount,
      totalViews,
      uniqueViewers,
      csvLink: excelFileSheetLink,
    };

    const reportMsg = {
      // to: seller.email,
      to: 'sai@velvet.video',
      from: { name: 'Velvet Orders', email: 'orders@velvet.video' },
      subject: `Orders Report`,
      templateId: 'd-c09e60f9cf2b496daff7db477dc87666',
      dynamic_template_data: templateData,
    };

    await sgMail.send(reportMsg);
  } catch (e) {
    logger.log('internal', e);
  }
}

```
