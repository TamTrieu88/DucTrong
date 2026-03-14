import React, { useState, useEffect } from 'react';
import { db } from '../firebase';
import { collection, onSnapshot, addDoc, updateDoc, doc, getDocs, query, where, orderBy, writeBatch } from 'firebase/firestore';
import { Recipe, RawMaterial, FinishedProduct, RawMaterialBatch } from '../types';
import { Play, CheckCircle2, AlertCircle, Loader2, FlaskConical } from 'lucide-react';
import { cn } from '../utils';
import { format } from 'date-fns';

export const Production: React.FC = () => {
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [products, setProducts] = useState<FinishedProduct[]>([]);
  const [materials, setMaterials] = useState<RawMaterial[]>([]);
  const [selectedRecipeId, setSelectedRecipeId] = useState('');
  const [batchesToProduce, setBatchesToProduce] = useState(1);
  const [actualQuantity, setActualQuantity] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

  useEffect(() => {
    onSnapshot(collection(db, 'DT_recipes'), (snap) => setRecipes(snap.docs.map(d => ({ id: d.id, ...d.data() } as Recipe))));
    onSnapshot(collection(db, 'DT_finished_products'), (snap) => setProducts(snap.docs.map(d => ({ id: d.id, ...d.data() } as FinishedProduct))));
    onSnapshot(collection(db, 'DT_raw_materials'), (snap) => setMaterials(snap.docs.map(d => ({ id: d.id, ...d.data() } as RawMaterial))));
  }, []);

  const handleProduction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRecipeId || batchesToProduce <= 0 || actualQuantity <= 0) return;

    setIsProcessing(true);
    setMessage(null);

    try {
      const recipe = recipes.find(r => r.id === selectedRecipeId);
      if (!recipe) throw new Error('Không tìm thấy công thức');

      const productId = recipe.productId;
      const product = products.find(p => p.id === productId);
      if (!product) throw new Error('Không tìm thấy sản phẩm đầu ra');

      const batch = writeBatch(db);
      const now = new Date().toISOString();
      let totalMaterialCost = 0;

      // 1. Consume Raw Materials (FIFO)
      for (const ingredient of recipe.ingredients) {
        const requiredQty = ingredient.quantity * batchesToProduce;
        const material = materials.find(m => m.id === ingredient.materialId);
        
        if (!material || material.totalQuantity < requiredQty) {
          throw new Error(`Không đủ nguyên liệu: ${material?.name || 'N/A'}`);
        }

        const batchesQuery = query(
          collection(db, 'DT_raw_material_batches'),
          where('materialId', '==', ingredient.materialId),
          where('quantity', '>', 0),
          orderBy('receivedDate', 'asc')
        );
        const batchesSnap = await getDocs(batchesQuery);
        
        let remainingToDeduct = requiredQty;
        for (const batchDoc of batchesSnap.docs) {
          if (remainingToDeduct <= 0) break;
          
          const batchData = batchDoc.data() as RawMaterialBatch;
          const deductAmount = Math.min(batchData.quantity, remainingToDeduct);
          
          batch.update(batchDoc.ref, { quantity: batchData.quantity - deductAmount });
          remainingToDeduct -= deductAmount;
          totalMaterialCost += (deductAmount * (batchData.costPerUnit || 0));

          const transRef = doc(collection(db, 'DT_transactions'));
          batch.set(transRef, {
            type: 'OUT',
            category: 'RAW_MATERIAL',
            itemId: ingredient.materialId,
            batchId: batchDoc.id,
            quantity: deductAmount,
            date: now,
            note: `Sản xuất ${batchesToProduce} mẻ ${recipe.name}`
          });
        }

        batch.update(doc(db, 'DT_raw_materials', ingredient.materialId), {
          totalQuantity: material.totalQuantity - requiredQty
        });
      }

      // 2. Create Finished Product Batch (Actual Quantity)
      const managementFee = totalMaterialCost * 0.2;
      const unitCost = (totalMaterialCost + managementFee) / actualQuantity;

      const productBatchNumber = `FP-${format(new Date(), 'yyyyMMdd')}-${Math.floor(Math.random() * 1000)}`;
      const productBatchRef = doc(collection(db, 'DT_finished_product_batches'));
      batch.set(productBatchRef, {
        productId: productId,
        batchNumber: productBatchNumber,
        quantity: actualQuantity,
        initialQuantity: actualQuantity,
        productionDate: now,
        materialCost: totalMaterialCost,
        managementFee,
        unitCost
      });

      // Update total product quantity
      batch.update(doc(db, 'DT_finished_products', productId), {
        totalQuantity: product.totalQuantity + actualQuantity
      });

      // Log production transaction
      const prodTransRef = doc(collection(db, 'DT_transactions'));
      const expectedTotal = recipe.outputQuantity * batchesToProduce;
      const loss = expectedTotal - actualQuantity;
      
      batch.set(prodTransRef, {
        type: 'PRODUCTION',
        category: 'FINISHED_PRODUCT',
        itemId: productId,
        batchId: productBatchRef.id,
        quantity: actualQuantity,
        date: now,
        note: `Sản xuất ${batchesToProduce} mẻ ${recipe.name}. Dự kiến: ${expectedTotal}${product.unit}, Thực tế: ${actualQuantity}${product.unit}, Hao hụt: ${loss.toFixed(2)}${product.unit}`
      });

      await batch.commit();
      setMessage({ type: 'success', text: 'Sản xuất thành công! Kho đã được cập nhật.' });
      setBatchesToProduce(1);
      setActualQuantity(0);
      setSelectedRecipeId('');
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message });
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <header>
        <h2 className="text-3xl font-serif font-bold text-slate-900">Lệnh sản xuất</h2>
        <p className="text-slate-500 mt-1">Thực hiện quy trình sản xuất và tự động trừ kho nguyên liệu.</p>
      </header>

      <div className="bg-white p-8 rounded-2xl border border-slate-100 shadow-sm">
        <form onSubmit={handleProduction} className="space-y-8">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="space-y-6">
              <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
                <FlaskConical className="w-4 h-4" />
                Cấu hình sản xuất
              </h3>
              
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Chọn công thức</label>
                <select 
                  className="w-full px-4 py-3 rounded-xl border border-slate-100 focus:ring-2 focus:ring-slate-900/5"
                  value={selectedRecipeId}
                  onChange={e => {
                    setSelectedRecipeId(e.target.value);
                    const recipe = recipes.find(r => r.id === e.target.value);
                    if (recipe) {
                      setActualQuantity(recipe.outputQuantity * batchesToProduce);
                    }
                  }}
                  required
                >
                  <option value="">-- Chọn công thức --</option>
                  {recipes.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </div>

              {selectedRecipeId && (
                <div className="p-4 bg-blue-50 rounded-xl border border-blue-100 space-y-1">
                  <p className="text-xs font-bold text-blue-600 uppercase tracking-wider">Thông tin công thức</p>
                  <p className="text-sm text-blue-900">
                    Sản phẩm: <span className="font-bold">{products.find(p => p.id === recipes.find(r => r.id === selectedRecipeId)?.productId)?.name || 'N/A'}</span>
                  </p>
                  <p className="text-sm text-blue-900">
                    Định mức: <span className="font-bold">{recipes.find(r => r.id === selectedRecipeId)?.outputQuantity || 0} {products.find(p => p.id === recipes.find(r => r.id === selectedRecipeId)?.productId)?.unit || ''} / mẻ</span>
                  </p>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Số mẻ sản xuất</label>
                  <input 
                    type="number" 
                    className="w-full px-4 py-3 rounded-xl border border-slate-100 focus:ring-2 focus:ring-slate-900/5"
                    value={batchesToProduce}
                    onChange={e => {
                      const val = Number(e.target.value);
                      setBatchesToProduce(val);
                      const recipe = recipes.find(r => r.id === selectedRecipeId);
                      if (recipe) {
                        setActualQuantity(recipe.outputQuantity * val);
                      }
                    }}
                    min="1"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Số lượng thực tế</label>
                  <input 
                    type="number" 
                    step="0.01"
                    className="w-full px-4 py-3 rounded-xl border border-slate-100 focus:ring-2 focus:ring-slate-900/5"
                    value={actualQuantity}
                    onChange={e => setActualQuantity(Number(e.target.value))}
                    min="0.01"
                    required
                  />
                </div>
              </div>

              {selectedRecipeId && (
                <div className="p-4 bg-slate-50 rounded-xl border border-slate-100">
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-slate-500">Dự kiến tổng:</span>
                    <span className="font-bold text-slate-900">
                      {(recipes.find(r => r.id === selectedRecipeId)?.outputQuantity || 0) * batchesToProduce} {products.find(p => p.id === recipes.find(r => r.id === selectedRecipeId)?.productId)?.unit || ''}
                    </span>
                  </div>
                  <div className="flex justify-between items-center text-sm mt-2">
                    <span className="text-slate-500">Hao hụt:</span>
                    <span className={cn(
                      "font-bold",
                      ((recipes.find(r => r.id === selectedRecipeId)?.outputQuantity || 0) * batchesToProduce - actualQuantity) > 0 ? "text-rose-600" : "text-emerald-600"
                    )}>
                      {((recipes.find(r => r.id === selectedRecipeId)?.outputQuantity || 0) * batchesToProduce - actualQuantity).toFixed(2)} {products.find(p => p.id === recipes.find(r => r.id === selectedRecipeId)?.productId)?.unit || ''}
                    </span>
                  </div>
                </div>
              )}
            </div>

            <div className="bg-slate-50 rounded-2xl p-6 space-y-4">
              <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider">Dự toán nguyên liệu</h3>
              {selectedRecipeId ? (
                <div className="space-y-3">
                  {recipes.find(r => r.id === selectedRecipeId)?.ingredients.map((ing, idx) => {
                    const mat = materials.find(m => m.id === ing.materialId);
                    const needed = ing.quantity * batchesToProduce;
                    const isEnough = (mat?.totalQuantity || 0) >= needed;
                    return (
                      <div key={idx} className="flex justify-between items-center text-sm">
                        <span className="text-slate-600">{mat?.name}</span>
                        <div className="text-right">
                          <p className={cn("font-bold", isEnough ? "text-slate-900" : "text-rose-600")}>
                            {needed} / {mat?.totalQuantity || 0} {mat?.unit}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-slate-400 text-sm italic">Vui lòng chọn công thức để xem định mức.</p>
              )}
            </div>
          </div>

          {message && (
            <div className={cn(
              "p-4 rounded-xl flex items-center gap-3",
              message.type === 'success' ? "bg-emerald-50 text-emerald-700 border border-emerald-100" : "bg-rose-50 text-rose-700 border border-rose-100"
            )}>
              {message.type === 'success' ? <CheckCircle2 className="w-5 h-5" /> : <AlertCircle className="w-5 h-5" />}
              <p className="text-sm font-medium">{message.text}</p>
            </div>
          )}

          <button 
            type="submit"
            disabled={isProcessing}
            className="w-full bg-slate-900 text-white py-4 rounded-xl font-bold hover:bg-slate-800 transition-all shadow-xl shadow-slate-200 flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {isProcessing ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <Play className="w-5 h-5 fill-current" />
            )}
            Bắt đầu sản xuất
          </button>
        </form>
      </div>
    </div>
  );
};

