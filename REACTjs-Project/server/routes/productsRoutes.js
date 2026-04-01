import { Router } from "express";
import {
  createProduct,
  deleteProduct,
  getUnitTypes,
  getGenericNames,
  getProductLotWhitelists,
  getProductUnitLevels,
  getReportGroups,
  getProductsSnapshot,
  getProductsVersion,
  listProducts,
  updateProductLotWhitelist,
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
router.get(
  "/:id/lot-whitelists",
  verifyToken,
  requireRole("ADMIN"),
  asyncHandler(getProductLotWhitelists)
);
router.post("/", verifyToken, requireRole("ADMIN"), asyncHandler(createProduct));
router.put("/:id", verifyToken, requireRole("ADMIN"), asyncHandler(updateProduct));
router.put(
  "/:id/lots/:lotId/whitelist",
  verifyToken,
  requireRole("ADMIN"),
  asyncHandler(updateProductLotWhitelist)
);
router.delete("/:id", verifyToken, requireRole("ADMIN"), asyncHandler(deleteProduct));

export default router;
