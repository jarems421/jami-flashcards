declare module "svg-to-pdfkit" {
  type SvgToPdfOptions = {
    width?: number;
    height?: number;
    preserveAspectRatio?: string;
    assumePt?: boolean;
    /** The registered PDFKit font to set SVG text in, given the family and style the SVG asks for. */
    fontCallback?: (family: string, bold: boolean, italic: boolean) => string;
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
