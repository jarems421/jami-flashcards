declare module "svg-to-pdfkit" {
  type SvgToPdfOptions = {
    width?: number;
    height?: number;
    preserveAspectRatio?: string;
    assumePt?: boolean;
  };

  const SVGtoPDF: (
    doc: PDFKit.PDFDocument,
    svg: string,
    x: number,
    y: number,
    options?: SvgToPdfOptions
  ) => void;

  export default SVGtoPDF;
}
