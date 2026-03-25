import { Router } from "express";
import {
  createProduct,
  deleteProduct,
  getUnitTypes,
  getGenericNames,
  getProductUnitLevels,
  getReportGroups,
  getProductsSnapshot,
  getProductsVersion,
  listProducts,
  updateProduct,
} from "../controllers/productsController.js";
import { requireRole, verifyToken } from "../middleware/authMiddleware.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const router = Router();

router.get("/", asyncHandler(listProducts));
router.get("/generic-names", asyncHandler(getGenericNames));
router.get("/unit-types", asyncHandler(getUnitTypes));
router.get("/report-groups", asyncHandler(getReportGroups));
router.get("/snapshot", asyncHandler(getProductsSnapshot));
router.get("/version", asyncHandler(getProductsVersion));
router.get("/:id/unit-levels", asyncHandler(getProductUnitLevels));
router.post("/", verifyToken, requireRole("ADMIN"), asyncHandler(createProduct));
router.put("/:id", verifyToken, requireRole("ADMIN"), asyncHandler(updateProduct));
router.delete("/:id", verifyToken, requireRole("ADMIN"), asyncHandler(deleteProduct));

export default router;
