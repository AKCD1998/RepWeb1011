import { Router } from "express";
import {
  createProduct,
  deleteProduct,
  getProductsSnapshot,
  getProductsVersion,
  listProducts,
  updateProduct,
} from "../controllers/productsController.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const router = Router();

router.get("/", asyncHandler(listProducts));
router.get("/snapshot", asyncHandler(getProductsSnapshot));
router.get("/version", asyncHandler(getProductsVersion));
router.post("/", asyncHandler(createProduct));
router.put("/:id", asyncHandler(updateProduct));
router.delete("/:id", asyncHandler(deleteProduct));

export default router;
