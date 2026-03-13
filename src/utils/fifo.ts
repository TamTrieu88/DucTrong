import { 
  collection, 
  query, 
  where, 
  orderBy, 
  getDocs, 
  updateDoc, 
  doc, 
  addDoc, 
  Timestamp,
  runTransaction
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { RawMaterialLot, FinishedProductLot } from '../types';

/**
 * FIFO Logic for consuming inventory
 * @param collectionName - 'raw_material_lots' or 'finished_product_lots'
 * @param itemIdField - 'materialId' or 'productId'
 * @param itemId - The ID of the item to consume
 * @param amountToConsume - Total quantity needed
 */
export async function consumeInventoryFIFO(
  collectionName: 'raw_material_lots' | 'finished_product_lots',
  itemIdField: 'materialId' | 'productId',
  itemId: string,
  amountToConsume: number
) {
  try {
    await runTransaction(db, async (transaction) => {
      // 1. Get all lots for this item, ordered by entryDate/productionDate (oldest first)
      const dateField = collectionName === 'raw_material_lots' ? 'entryDate' : 'productionDate';
      const lotsRef = collection(db, collectionName);
      const q = query(
        lotsRef, 
        where(itemIdField, '==', itemId), 
        where('remainingQuantity', '>', 0),
        orderBy(dateField, 'asc')
      );
      
      const querySnapshot = await getDocs(q);
      let remainingToConsume = amountToConsume;
      
      if (querySnapshot.empty) {
        throw new Error('Không đủ hàng trong kho');
      }

      for (const lotDoc of querySnapshot.docs) {
        if (remainingToConsume <= 0) break;
        
        const lotData = lotDoc.data() as RawMaterialLot | FinishedProductLot;
        const availableInLot = lotData.remainingQuantity;
        
        if (availableInLot >= remainingToConsume) {
          // This lot can cover the rest of the consumption
          transaction.update(lotDoc.ref, {
            remainingQuantity: availableInLot - remainingToConsume
          });
          remainingToConsume = 0;
        } else {
          // This lot is fully consumed, move to next
          transaction.update(lotDoc.ref, {
            remainingQuantity: 0
          });
          remainingToConsume -= availableInLot;
        }
      }

      if (remainingToConsume > 0) {
        throw new Error('Không đủ hàng trong kho để hoàn thành yêu cầu');
      }

      // Update the main item's currentStock
      const itemCollection = collectionName === 'raw_material_lots' ? 'raw_materials' : 'finished_products';
      const itemRef = doc(db, itemCollection, itemId);
      const itemSnap = await transaction.get(itemRef);
      if (itemSnap.exists()) {
        const currentStock = itemSnap.data().currentStock || 0;
        transaction.update(itemRef, {
          currentStock: Math.max(0, currentStock - amountToConsume)
        });
      }
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, collectionName);
  }
}
