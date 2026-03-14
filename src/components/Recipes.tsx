import React, { useState, useEffect } from 'react';
import { db } from '../firebase';
import { collection, onSnapshot, addDoc, updateDoc, doc, deleteDoc, getDocs, query, where, orderBy, writeBatch } from 'firebase/firestore';
import { Recipe, RawMaterial, FinishedProduct, RawMaterialBatch } from '../types';
import { Plus, FlaskConical, Trash2, Edit2, Package, AlertTriangle, Play, CheckCircle2, AlertCircle, Loader2, X } from 'lucide-react';
import { cn } from '../utils';
import { format } from 'date-fns';
import { ConfirmDialog, useConfirmDialog } from './ConfirmDialog';

const getAvailableUnits = (baseUnit: string) => {
  const lower = (baseUnit || '').toLowerCase();
  if (['kg', 'g', 'gam'].includes(lower)) return ['kg', 'g'];
  if (['lít', 'lit', 'l', 'ml'].includes(lower)) return ['lít', 'ml'];
  return [baseUnit || ''];
};

const convertToTargetUnit = (quantity: number, fromUnit: string, toUnit: string) => {
  const f = (fromUnit || '').toLowerCase();
  const t = (toUnit || '').toLowerCase();
  if (f === t) return quantity;
  if ((f === 'g' || f === 'gam') && t === 'kg') return quantity / 1000;
  if (f === 'kg' && (t === 'g' || t === 'gam')) return quantity * 1000;
  if (f === 'ml' && ['lít', 'lit', 'l'].includes(t)) return quantity / 1000;
  if (['lít', 'lit', 'l'].includes(f) && t === 'ml') return quantity * 1000;
  return quantity;
};

export const Recipes: React.FC = () => {
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [materials, setMaterials] = useState<RawMaterial[]>([]);
  const [products, setProducts] = useState<FinishedProduct[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingRecipe, setEditingRecipe] = useState<Recipe | null>(null);
  const [newRecipe, setNewRecipe] = useState({ 
    name: '', 
    productId: '', 
    outputQuantity: 0,
    ingredients: [] as { materialId: string, quantity: number, unit?: string }[] 
  });

  const [showProductionModal, setShowProductionModal] = useState(false);
  const [selectedRecipeForProduction, setSelectedRecipeForProduction] = useState<Recipe | null>(null);
  const [batchesToProduce, setBatchesToProduce] = useState(1);
  const [actualQuantity, setActualQuantity] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);
  const { confirm, dialogProps } = useConfirmDialog();

  useEffect(() => {
    const unsubRec = onSnapshot(collection(db, 'DT_recipes'), (snap) => {
      setRecipes(snap.docs.map(d => ({ id: d.id, ...d.data() } as Recipe)));
    });
    const unsubMat = onSnapshot(collection(db, 'DT_raw_materials'), (snap) => {
      setMaterials(snap.docs.map(d => ({ id: d.id, ...d.data() } as RawMaterial)));
    });
    const unsubProd = onSnapshot(collection(db, 'DT_finished_products'), (snap) => {
      setProducts(snap.docs.map(d => ({ id: d.id, ...d.data() } as FinishedProduct)));
    });
    return () => {
      unsubRec();
      unsubMat();
      unsubProd();
    };
  }, []);

  const handleAddIngredient = () => {
    setNewRecipe({
      ...newRecipe,
      ingredients: [...newRecipe.ingredients, { materialId: '', quantity: 0, unit: '' }]
    });
  };

  const handleSaveRecipe = async (e: React.FormEvent) => {
    e.preventDefault();
    if (editingRecipe) {
      const recipeRef = doc(db, 'DT_recipes', editingRecipe.id);
      await updateDoc(recipeRef, {
        ...newRecipe,
        ingredients: newRecipe.ingredients.map(ing => ({
          materialId: ing.materialId,
          quantity: ing.quantity,
          unit: ing.unit || materials.find(m => m.id === ing.materialId)?.unit || ''
        }))
      });
      setEditingRecipe(null);
    } else {
      await addDoc(collection(db, 'DT_recipes'), {
        ...newRecipe,
        ingredients: newRecipe.ingredients.map(ing => ({
          materialId: ing.materialId,
          quantity: ing.quantity,
          unit: ing.unit || materials.find(m => m.id === ing.materialId)?.unit || ''
        }))
      });
    }
    setNewRecipe({ name: '', productId: '', outputQuantity: 0, ingredients: [] });
    setShowAddModal(false);
  };

  const handleDeleteRecipe = async (id: string) => {
    const ok = await confirm({
      title: 'Xóa công thức',
      message: 'Bạn có chắc chắn muốn xóa công thức này?',
      confirmText: 'Xóa',
    });
    if (ok) {
      await deleteDoc(doc(db, 'DT_recipes', id));
    }
  };

  const handleProduction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRecipeForProduction || batchesToProduce <= 0 || actualQuantity <= 0) return;

    setIsProcessing(true);
    setMessage(null);

    try {
      const recipe = selectedRecipeForProduction;
      const productId = recipe.productId;
      const product = products.find(p => p.id === productId);
      if (!product) throw new Error('Không tìm thấy sản phẩm đầu ra');

      const batch = writeBatch(db);
      const now = new Date().toISOString();
      let totalMaterialCost = 0;

      // 1. Consume Raw Materials (FIFO)
      for (const ingredient of recipe.ingredients) {
        const material = materials.find(m => m.id === ingredient.materialId);
        if (!material) throw new Error(`Không tìm thấy nguyên liệu`);

        const inputUnit = ingredient.unit || material.unit;
        const requiredQtyBase = convertToTargetUnit(ingredient.quantity, inputUnit, material.unit) * batchesToProduce;
        
        if (material.totalQuantity < requiredQtyBase) {
          throw new Error(`Không đủ nguyên liệu: ${material.name}`);
        }

        const batchesQuery = query(
          collection(db, 'DT_raw_material_batches'),
          where('materialId', '==', ingredient.materialId),
          where('quantity', '>', 0),
          orderBy('receivedDate', 'asc')
        );
        const batchesSnap = await getDocs(batchesQuery);
        
        let remainingToDeduct = requiredQtyBase;
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
          totalQuantity: material.totalQuantity - requiredQtyBase
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
      
      setTimeout(() => {
        setBatchesToProduce(1);
        setActualQuantity(0);
        setSelectedRecipeForProduction(null);
        setShowProductionModal(false);
      }, 1500);

    } catch (error: any) {
      setMessage({ type: 'error', text: error.message });
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-serif font-bold text-slate-900">Công thức & Sản xuất</h2>
          <p className="text-slate-500 mt-1">Định mức nguyên liệu cho từng loại sản phẩm.</p>
        </div>
        <button 
          onClick={() => setShowAddModal(true)}
          className="flex items-center gap-2 bg-slate-900 text-white px-6 py-3 rounded-xl hover:bg-slate-800 transition-all shadow-lg shadow-slate-200 font-medium"
        >
          <Plus className="w-5 h-5" />
          Tạo công thức mới
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        {recipes.map(recipe => {
          return (
            <div key={recipe.id} className="bg-white p-8 rounded-2xl border border-slate-100 shadow-sm hover:shadow-md transition-shadow group relative flex flex-col">
              <div className="absolute top-4 right-4 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                <button 
                  onClick={() => {
                    setEditingRecipe(recipe);
                    setNewRecipe({ 
                      name: recipe.name || '', 
                      productId: recipe.productId || '', 
                      outputQuantity: recipe.outputQuantity || 0, 
                      ingredients: recipe.ingredients ? recipe.ingredients.map(i => ({...i})) : [{ materialId: '', quantity: 0, unit: '' }] 
                    });
                    setShowAddModal(true);
                  }}
                  className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                >
                  <Edit2 className="w-4 h-4" />
                </button>
                <button 
                  onClick={() => handleDeleteRecipe(recipe.id)}
                  className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
              <div className="flex items-center gap-3 mb-6">
                <div className="p-2 bg-slate-100 rounded-lg shrink-0">
                  <FlaskConical className="w-5 h-5 text-slate-600" />
                </div>
                <div>
                  <h3 className="font-serif font-bold text-xl line-clamp-1">{recipe.name}</h3>
                  <p className="text-xs text-slate-500 flex items-center gap-1 mt-0.5">
                    <Package className="w-3 h-3" />
                    Đầu ra: {recipe.outputQuantity} {products.find(p => p.id === recipe.productId)?.unit || ''} {products.find(p => p.id === recipe.productId)?.name || ''} / mẻ
                  </p>
                </div>
              </div>
              
              <div className="space-y-3 flex-1 mb-6">
                <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Thành phần nguyên liệu (Mẻ):</p>
                {recipe.ingredients.map((ing, idx) => {
                  const mat = materials.find(m => m.id === ing.materialId);
                  return (
                    <div key={idx} className="flex justify-between items-center py-2 border-b border-slate-50 last:border-0">
                      <span className="text-slate-700 font-medium">{mat?.name || 'N/A'}</span>
                      <span className="text-slate-900 font-bold">
                        {ing.quantity} {ing.unit || mat?.unit || ''}
                      </span>
                    </div>
                  );
                })}
              </div>

              <div className="mt-auto border-t border-slate-50 pt-4">
                <button 
                  onClick={() => {
                    setSelectedRecipeForProduction(recipe);
                    setBatchesToProduce(1);
                    setActualQuantity(recipe.outputQuantity);
                    setShowProductionModal(true);
                    setMessage(null);
                  }}
                  className="w-full flex items-center justify-center gap-2 bg-purple-600 text-white py-3 rounded-xl hover:bg-purple-700 transition-colors font-bold shadow-lg shadow-purple-200"
                >
                  <Play className="w-4 h-4 fill-current" />
                  Sản xuất lô này
                </button>
              </div>


            </div>
          );
        })}
      </div>

      {showAddModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white w-full max-w-2xl rounded-2xl shadow-2xl p-8 max-h-[90vh] overflow-auto">
            <h3 className="text-2xl font-serif font-bold mb-6">
              {editingRecipe ? 'Sửa công thức' : 'Tạo công thức mới'}
            </h3>
            <form onSubmit={handleSaveRecipe} className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Tên công thức</label>
                  <input 
                    type="text" 
                    className="w-full px-4 py-3 rounded-xl border border-slate-100 focus:outline-none focus:ring-2 focus:ring-slate-900/5"
                    value={newRecipe.name}
                    onChange={e => setNewRecipe({...newRecipe, name: e.target.value})}
                    placeholder="VD: Muối tôm đặc biệt"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Sản phẩm đầu ra</label>
                  <select 
                    className="w-full px-4 py-3 rounded-xl border border-slate-100"
                    value={newRecipe.productId}
                    onChange={e => setNewRecipe({...newRecipe, productId: e.target.value})}
                    required
                  >
                    <option value="">-- Chọn sản phẩm --</option>
                    {products.map(p => <option key={p.id} value={p.id}>{p.name} ({p.unit})</option>)}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Số lượng thành phẩm chuẩn / mẻ</label>
                <div className="relative">
                  <input 
                    type="number" 
                    step="0.01"
                    className="w-full px-4 py-3 rounded-xl border border-slate-100 focus:outline-none focus:ring-2 focus:ring-slate-900/5"
                    value={newRecipe.outputQuantity}
                    onChange={e => setNewRecipe({...newRecipe, outputQuantity: Number(e.target.value)})}
                    required
                  />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 text-sm">
                    {products.find(p => p.id === newRecipe.productId)?.unit || ''}
                  </span>
                </div>
              </div>
              
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-bold text-slate-400 uppercase">Thành phần nguyên liệu</label>
                  <button 
                    type="button"
                    onClick={handleAddIngredient}
                    className="text-xs font-bold text-blue-600 hover:underline"
                  >
                    + Thêm nguyên liệu
                  </button>
                </div>
                {newRecipe.ingredients.map((ing, idx) => (
                  <div key={idx} className="flex gap-4 items-end">
                    <div className="flex-1">
                      <select 
                        className="w-full px-4 py-3 rounded-xl border border-slate-100"
                        value={ing.materialId}
                        onChange={e => {
                          const newIngs = [...newRecipe.ingredients];
                          const newMatId = e.target.value;
                          newIngs[idx].materialId = newMatId;
                          newIngs[idx].unit = materials.find(m => m.id === newMatId)?.unit || '';
                          setNewRecipe({...newRecipe, ingredients: newIngs});
                        }}
                        required
                      >
                        <option value="">-- Chọn nguyên liệu --</option>
                        {materials.map(m => <option key={m.id} value={m.id}>{m.name} ({m.unit})</option>)}
                      </select>
                    </div>
                    <div className="w-56 flex gap-2">
                      <input 
                        type="number" 
                        step="0.01"
                        className="w-full px-4 py-3 rounded-xl border border-slate-100 flex-1"
                        value={ing.quantity || ''}
                        onChange={e => {
                          const newIngs = [...newRecipe.ingredients];
                          newIngs[idx].quantity = Number(e.target.value);
                          setNewRecipe({...newRecipe, ingredients: newIngs});
                        }}
                        placeholder="SL"
                        required
                      />
                      <select 
                        className="w-24 px-2 py-3 rounded-xl border border-slate-100 bg-slate-50 text-sm font-medium"
                        value={ing.unit || materials.find(m => m.id === ing.materialId)?.unit || ''}
                        onChange={e => {
                          const newIngs = [...newRecipe.ingredients];
                          newIngs[idx].unit = e.target.value;
                          setNewRecipe({...newRecipe, ingredients: newIngs});
                        }}
                      >
                        {getAvailableUnits(materials.find(m => m.id === ing.materialId)?.unit || '').map(u => (
                          <option key={u} value={u}>{u}</option>
                        ))}
                      </select>
                    </div>
                    <button 
                      type="button"
                      onClick={() => {
                        const newIngs = newRecipe.ingredients.filter((_, i) => i !== idx);
                        setNewRecipe({...newRecipe, ingredients: newIngs});
                      }}
                      className="p-3 text-rose-500 hover:bg-rose-50 rounded-xl"
                    >
                      <Trash2 className="w-5 h-5" />
                    </button>
                  </div>
                ))}
              </div>

              <div className="flex gap-3 pt-4">
                <button 
                  type="button"
                  onClick={() => {
                    setShowAddModal(false);
                    setEditingRecipe(null);
                    setNewRecipe({ name: '', productId: '', outputQuantity: 0, ingredients: [] });
                  }}
                  className="flex-1 px-6 py-3 rounded-xl border border-slate-100 font-bold text-slate-500 hover:bg-slate-50"
                >
                  Hủy
                </button>
                <button 
                  type="submit"
                  className="flex-1 px-6 py-3 rounded-xl bg-slate-900 text-white font-bold hover:bg-slate-800 shadow-lg shadow-slate-200"
                >
                  {editingRecipe ? 'Cập nhật' : 'Lưu công thức'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showProductionModal && selectedRecipeForProduction && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white w-full max-w-2xl rounded-2xl shadow-2xl p-8 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-2xl font-serif font-bold text-slate-900">
                Sản xuất: {selectedRecipeForProduction.name}
              </h3>
              <button onClick={() => setShowProductionModal(false)} className="p-2 text-slate-400 hover:text-slate-900 hover:bg-slate-100 rounded-xl transition-colors">
                <X className="w-6 h-6" />
              </button>
            </div>

            <form onSubmit={handleProduction} className="space-y-8">
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
                      setActualQuantity(selectedRecipeForProduction.outputQuantity * val);
                    }}
                    min="1"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Số lượng đầu ra thực tế</label>
                  <div className="relative">
                    <input 
                      type="number" 
                      step="0.01"
                      className="w-full px-4 py-3 rounded-xl border border-slate-100 focus:ring-2 focus:ring-slate-900/5"
                      value={actualQuantity}
                      onChange={e => setActualQuantity(Number(e.target.value))}
                      min="0.01"
                      required
                    />
                    <span className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 text-sm">
                      {products.find(p => p.id === selectedRecipeForProduction.productId)?.unit || ''}
                    </span>
                  </div>
                </div>
              </div>

              <div className="p-4 bg-slate-50 rounded-xl border border-slate-100">
                <div className="flex justify-between items-center text-sm">
                  <span className="text-slate-500">Dự kiến tổng (Theo công thức):</span>
                  <span className="font-bold text-slate-900">
                    {selectedRecipeForProduction.outputQuantity * batchesToProduce} {products.find(p => p.id === selectedRecipeForProduction.productId)?.unit || ''}
                  </span>
                </div>
                <div className="flex justify-between items-center text-sm mt-2">
                  <span className="text-slate-500">Độ chênh lệch (Hao hụt/Dư):</span>
                  <span className={cn(
                    "font-bold",
                    (selectedRecipeForProduction.outputQuantity * batchesToProduce - actualQuantity) > 0 ? "text-rose-600" : "text-emerald-600"
                  )}>
                    {(selectedRecipeForProduction.outputQuantity * batchesToProduce - actualQuantity).toFixed(2)} {products.find(p => p.id === selectedRecipeForProduction.productId)?.unit || ''}
                  </span>
                </div>
              </div>

              <div className="bg-slate-50 rounded-2xl p-6 space-y-4">
                <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider">Dự toán nguyên liệu cần trừ (FIFO)</h3>
                <div className="space-y-3">
                  {selectedRecipeForProduction.ingredients.map((ing, idx) => {
                    const mat = materials.find(m => m.id === ing.materialId);
                    const neededInput = ing.quantity * batchesToProduce;
                    const neededBase = convertToTargetUnit(ing.quantity, ing.unit || mat?.unit || '', mat?.unit || '') * batchesToProduce;
                    const isEnough = (mat?.totalQuantity || 0) >= neededBase;
                    return (
                      <div key={idx} className="flex justify-between items-center text-sm border-b border-slate-200/50 pb-2 last:border-0 last:pb-0">
                        <span className="text-slate-600 font-medium">{mat?.name}</span>
                        <div className="text-right">
                          <p className={cn("font-bold text-sm", isEnough ? "text-slate-900" : "text-rose-600")}>
                            {neededInput} {ing.unit || mat?.unit || ''} / <span className="text-xs font-normal text-slate-500">Tồn: {mat?.totalQuantity || 0} {mat?.unit || ''}</span>
                          </p>
                          {!isEnough && <p className="text-[10px] text-rose-500 mt-0.5">Không đủ nguyên liệu trong kho</p>}
                        </div>
                      </div>
                    );
                  })}
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
      )}

      <ConfirmDialog {...dialogProps} />
    </div>
  );
};
