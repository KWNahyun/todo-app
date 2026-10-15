// 릴리스에서 콘솔 창 안 띄움
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    dailytodo_lib::run()
}
