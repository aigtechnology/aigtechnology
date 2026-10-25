import {
  addDoc, collection, deleteDoc, doc, getDoc, getDocs, limit, orderBy,
  query, serverTimestamp, setDoc, updateDoc, where
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import { db, isFirebaseConfigured } from "./firebase-client.js";

function requireDatabase() {
  if (!isFirebaseConfigured || !db) throw new Error("Firebase is not configured yet. Add your web app settings in assets/js/firebase-config.js.");
  return db;
}

export async function getProducts({ featured = false, max = 60 } = {}) {
  const database = requireDatabase();
  const constraints = [where("published", "==", true), limit(featured ? 200 : max)];
  const snapshot = await getDocs(query(collection(database, "products"), ...constraints));
  const products = snapshot.docs
    .map(item => ({ id: item.id, ...item.data() }))
    .filter(product => !featured || product.featured === true)
    .sort((left, right) => String(left.name || "").localeCompare(String(right.name || "")));
  return products.slice(0, max);
}

export async function getProductById(id) {
  const database = requireDatabase();
  const result = await getDoc(doc(database, "products", id));
  if (!result.exists() || !result.data().published) return null;
  return { id: result.id, ...result.data() };
}

export async function getPublicSettings() {
  const database = requireDatabase();
  const result = await getDoc(doc(database, "settings", "publicSite"));
  return result.exists() ? result.data() : {};
}

export async function submitEnquiry(data) {
  const database = requireDatabase();
  return addDoc(collection(database, "enquiries"), {
    ...data,
    status: "New",
    internalNotes: "",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
}

export async function submitServiceEnquiry(data) {
  return submitEnquiry({
    name: data.name,
    phone: data.phone,
    email: data.email || "",
    productId: "",
    productName: "",
    serviceCategory: data.serviceCategory,
    brand: data.brand || "",
    model: data.model || "",
    preferredContactMethod: data.preferredContactMethod || "",
    message: [
      `Service enquiry: ${data.serviceCategory}`,
      data.description,
      data.brand ? `Brand: ${data.brand}` : "",
      data.model ? `Model: ${data.model}` : "",
      data.preferredContactMethod ? `Preferred contact: ${data.preferredContactMethod}` : ""
    ].filter(Boolean).join("\n\n")
  });
}

export async function adminListProducts() {
  const database = requireDatabase();
  const snapshot = await getDocs(query(collection(database, "products"), orderBy("updatedAt", "desc"), limit(200)));
  return snapshot.docs.map(item => ({ id: item.id, ...item.data() }));
}

export async function saveProduct(id, data) {
  const database = requireDatabase();
  const payload = { ...data, updatedAt: serverTimestamp() };
  if (id) return updateDoc(doc(database, "products", id), payload);
  return addDoc(collection(database, "products"), { ...payload, createdAt: serverTimestamp() });
}

export async function removeProduct(id) {
  return deleteDoc(doc(requireDatabase(), "products", id));
}

export async function adminListEnquiries(status = "") {
  const database = requireDatabase();
  const constraints = [];
  if (status) constraints.push(where("status", "==", status));
  constraints.push(orderBy("createdAt", "desc"), limit(200));
  const snapshot = await getDocs(query(collection(database, "enquiries"), ...constraints));
  return snapshot.docs.map(item => ({ id: item.id, ...item.data() }));
}

export async function updateEnquiry(id, data) {
  return updateDoc(doc(requireDatabase(), "enquiries", id), { ...data, updatedAt: serverTimestamp() });
}

export async function removeEnquiry(id) {
  return deleteDoc(doc(requireDatabase(), "enquiries", id));
}

export async function savePublicSettings(data) {
  return setDoc(doc(requireDatabase(), "settings", "publicSite"), { ...data, updatedAt: serverTimestamp() }, { merge: true });
}

export async function readAdminSettings() {
  return getPublicSettings();
}
