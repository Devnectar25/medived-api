const fs = require('fs');
const path = "c:\\Workplace\\homeved\\reactshop-home\\src\\pages\\admin\\OrderManagement.tsx";
const raw = fs.readFileSync(path, 'utf8');
const eol = raw.includes('\r\n') ? '\r\n' : '\n';
let content = raw.split(eol);

// Indices (0-based) for lines 634-636 (1-based)
content[633] = '                                                    <SelectItem value="Confirmed">Confirmed</SelectItem>';
content[634] = '                                                    <SelectItem value="Processing">Processing</SelectItem>';
content[635] = '                                                    <SelectItem value="Shipped">Shipped</SelectItem>';
content.splice(636, 0, '                                                    <SelectItem value="Out for Delivery">Out for Delivery</SelectItem>');

fs.writeFileSync(path, content.join(eol));
console.log('OrderManagement.tsx updated successfully using line manipulation.');
